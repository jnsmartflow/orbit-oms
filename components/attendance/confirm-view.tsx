"use client";

import { Camera, MapPin, MapPinOff, AlertTriangle, User as UserIcon } from "lucide-react";
import { formatIstClock } from "@/lib/attendance/format";
import type { LocationStatus } from "./camera-view";

interface ConfirmViewProps {
  title: string;                 // "Confirm Check-In" | "Confirm Check-Out"
  ctaLabel: string;              // "Confirm Check-In" | "Confirm Check-Out"
  photoDataUrl: string;
  capturedAtISO: string;
  locationStatus: LocationStatus;
  locationDistanceMeters: number | null;
  userName: string;
  userRole: string;              // role slug, e.g. "tint_manager"
  submitting: boolean;
  errorMessage: string | null;
  onConfirm(): void;
  onRetake(): void;
  onCancel(): void;
}

export function ConfirmView({
  title,
  ctaLabel,
  photoDataUrl,
  capturedAtISO,
  locationStatus,
  locationDistanceMeters,
  userName,
  userRole,
  submitting,
  errorMessage,
  onConfirm,
  onRetake,
  onCancel,
}: ConfirmViewProps) {
  return (
    <div>
      {/* Header — minimal title + cancel link */}
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-[16px] font-semibold text-gray-900">{title}</h1>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[13px] text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </header>

      {/* Photo thumbnail with retake overlay */}
      <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden bg-gray-200 mb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoDataUrl}
          alt="Captured selfie"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <button
          type="button"
          onClick={onRetake}
          disabled={submitting}
          className="absolute top-3 right-3 flex items-center gap-1.5 h-9 px-3 rounded-full bg-black/60 hover:bg-black/75 backdrop-blur-sm text-white text-[12px] font-medium disabled:opacity-50"
        >
          <Camera className="w-3.5 h-3.5" />
          Retake
        </button>
      </div>

      {/* Detail rows */}
      <dl className="space-y-2.5 mb-4">
        <DetailRow label="Time" value={formatIstClock(capturedAtISO)} />
        <DetailRow
          label="Location"
          value={<LocationStatusBadge status={locationStatus} distanceMeters={locationDistanceMeters} />}
        />
        <DetailRow label="You" value={`${userName} · ${formatRole(userRole)}`} />
      </dl>

      {/* Outside-geofence warning (Q2) */}
      {locationStatus === "outside" && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-md bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-800 leading-snug">
            {locationDistanceMeters ? `${locationDistanceMeters}m` : "Outside"} from depot — will be flagged for review.
          </p>
        </div>
      )}

      {/* Inline error block */}
      {errorMessage && (
        <div
          role="alert"
          className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-[13px] text-red-700"
        >
          {errorMessage}
        </div>
      )}

      {/* Confirm CTA */}
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className="w-full h-[72px] rounded-2xl bg-teal-600 hover:bg-teal-700 text-white text-[16px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-teal-600 shadow-sm"
      >
        {submitting ? "Submitting…" : ctaLabel}
      </button>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 bg-white border border-gray-200 rounded-lg">
      <dt className="text-[12px] uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-[13.5px] text-gray-800 tabular-nums text-right">{value}</dd>
    </div>
  );
}

function LocationStatusBadge({
  status,
  distanceMeters,
}: {
  status: LocationStatus;
  distanceMeters: number | null;
}) {
  let bg: string;
  let text: string;
  let border: string;
  let Icon = MapPin;
  let label: string;
  switch (status) {
    case "verified":
      bg = "bg-emerald-50";
      border = "border-emerald-200";
      text = "text-emerald-700";
      label = "At depot";
      break;
    case "outside":
      bg = "bg-amber-50";
      border = "border-amber-200";
      text = "text-amber-700";
      label = distanceMeters ? `${distanceMeters}m away` : "Outside";
      break;
    case "unavailable":
      bg = "bg-gray-50";
      border = "border-gray-200";
      text = "text-gray-600";
      Icon = MapPinOff;
      label = "Unavailable";
      break;
    case "requesting":
    default:
      bg = "bg-gray-50";
      border = "border-gray-200";
      text = "text-gray-500";
      label = "Locating…";
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${bg} ${border} ${text} text-[11.5px] font-medium`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function formatRole(slug: string): string {
  if (!slug) return "—";
  return slug
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
