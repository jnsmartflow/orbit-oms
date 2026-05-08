"use client";

import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { formatIstClock } from "@/lib/attendance/format";

interface SuccessViewProps {
  headline: string;          // "You're checked in" | "Day complete"
  timestampISO: string;
  extraInfo?: string;        // optional secondary line (e.g. "Shift ends 7:00 PM")
  redirectMs?: number;       // defaults to 1500
  onRedirect(): void;
}

export function SuccessView({
  headline,
  timestampISO,
  extraInfo,
  redirectMs = 1500,
  onRedirect,
}: SuccessViewProps) {
  useEffect(() => {
    const id = setTimeout(onRedirect, redirectMs);
    return () => clearTimeout(id);
  }, [onRedirect, redirectMs]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <CheckCircle2 className="w-24 h-24 text-emerald-500 mb-4" strokeWidth={1.5} />
      <h2 className="text-[22px] font-semibold text-gray-900 mb-1">{headline}</h2>
      <p className="text-[14px] text-gray-500 tabular-nums">{formatIstClock(timestampISO)}</p>
      {extraInfo && (
        <div className="mt-5 px-4 py-3 bg-white border border-gray-200 rounded-lg">
          <p className="text-[13px] text-gray-600 tabular-nums">{extraInfo}</p>
        </div>
      )}
    </div>
  );
}
