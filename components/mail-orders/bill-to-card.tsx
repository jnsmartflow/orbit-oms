"use client";

import type { ReactNode } from "react";
import type { OrderSignal } from "@/lib/mail-orders/utils";
import { SignalPill } from "./signal-pill";

interface BillToCardProps {
  customerName: string | null;
  customerCode: string | null;
  customerArea: string | null;
  customerDeliveryType: string | null;
  customerMatchStatus: "exact" | "multiple" | "unmatched" | null;
  signals: OrderSignal[];
  onCodeClick?: () => void;
  popoverSlot?: ReactNode;
  chipFallbackLabel?: string;
}

function getDeliveryDotClass(type: string | null | undefined): string {
  switch ((type ?? "").toUpperCase()) {
    case "LOCAL": return "bg-blue-600";
    case "UPCOUNTRY":
    case "UPC": return "bg-orange-600";
    case "IGT": return "bg-teal-600";
    case "CROSS": return "bg-rose-600";
    default: return "bg-gray-300";
  }
}

function getCodeChipClass(status: BillToCardProps["customerMatchStatus"]): string {
  switch (status) {
    case "multiple": return "bg-amber-50 text-amber-700 border-amber-200";
    case "unmatched": return "bg-red-50 text-red-700 border-red-200";
    case "exact":
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export function BillToCard({
  customerName,
  customerCode,
  customerArea,
  customerDeliveryType,
  customerMatchStatus,
  signals,
  onCodeClick,
  popoverSlot,
  chipFallbackLabel,
}: BillToCardProps): JSX.Element {
  const dotClass = getDeliveryDotClass(customerDeliveryType);
  const codeChipClass = getCodeChipClass(customerMatchStatus);

  const showCode = !!customerCode || !!chipFallbackLabel;
  const chipContent = customerCode ?? chipFallbackLabel;
  const showArea = !!customerArea;
  const showRegion = !!customerDeliveryType;
  const hasDetail = showCode || showArea || showRegion;

  const chipClass = `font-mono text-[11px] px-1.5 py-px rounded border ${codeChipClass}`;
  const chipNode = onCodeClick ? (
    <button type="button" onClick={onCodeClick} className={`${chipClass} cursor-pointer`}>
      {chipContent}
    </button>
  ) : (
    <span className={chipClass}>{chipContent}</span>
  );
  const chipWithPopover = popoverSlot ? (
    <span className="relative inline-flex items-center">
      {chipNode}
      <div className="absolute left-0 top-full mt-1 z-50">{popoverSlot}</div>
    </span>
  ) : chipNode;

  return (
    <div className="relative bg-white border border-gray-200 rounded-lg px-3 py-2.5">
      <div className="mb-1">
        <span className="text-[9.5px] font-semibold tracking-[0.06em] uppercase text-gray-400">
          Bill to
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 mb-[3px]">
        <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-[14.5px] font-bold text-gray-900 tracking-tight truncate">
          {customerName ?? "—"}
        </span>
      </div>

      {hasDetail && (
        <div className="flex items-center gap-2 text-[11.5px] text-gray-500">
          {showCode && chipWithPopover}
          {showCode && showArea && <span>·</span>}
          {showArea && <span>{customerArea}</span>}
          {(showCode || showArea) && showRegion && <span>·</span>}
          {showRegion && <span className="text-[11px]">{customerDeliveryType}</span>}
        </div>
      )}

      {signals.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {signals.map((s, i) => (
            <SignalPill key={`${s.label}-${i}`} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}
