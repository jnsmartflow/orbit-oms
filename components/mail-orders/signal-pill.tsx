"use client";

import type { OrderSignal } from "@/lib/mail-orders/utils";
import { Truck } from "lucide-react";

interface SignalPillProps {
  signal: OrderSignal;
}

const COLOUR_BY_TYPE = {
  blocker:   "bg-red-50 text-red-700 border-red-200",
  attention: "bg-amber-50 text-amber-700 border-amber-200",
  info:      "bg-gray-100 text-gray-700 border-gray-200",
  split:     "bg-purple-50 text-purple-700 border-purple-200",
  bill:      "bg-blue-50 text-blue-700 border-blue-200",
} as const;

export function SignalPill({ signal }: SignalPillProps): JSX.Element {
  if (signal.type === "truck-order") {
    return (
      <span
        className="relative text-[9px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0 inline-flex items-center gap-1 bg-violet-50 text-violet-700 border-violet-200"
        title="Truck Order — punch when material received"
      >
        <Truck size={12} strokeWidth={2} />
        {signal.label}
      </span>
    );
  }

  if (signal.type === "status") {
    const colour = signal.label === "Hold"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-green-50 text-green-700 border-green-200";
    return (
      <span className={`relative text-[9px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${colour}`}>
        {signal.label}
      </span>
    );
  }

  return (
    <span className={`relative text-[9px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${COLOUR_BY_TYPE[signal.type]}`}>
      {signal.dot && (
        <span className={`absolute -top-[3px] -right-[3px] w-[5px] h-[5px] rounded-full ${signal.dot}`} />
      )}
      {signal.label}
    </span>
  );
}
