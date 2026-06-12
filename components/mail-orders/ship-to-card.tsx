"use client";

import type { OrderSignal } from "@/lib/mail-orders/utils";
import { MO_TAG } from "@/lib/hide/tag-catalog";
import { SignalPill } from "./signal-pill";

interface ShipToCardProps {
  shipToName: string;
  shipToCode: string | null;
  shipToArea: string | null;
  shipToDeliveryType: string | null;
  isOverride: boolean;
  signals: OrderSignal[];
  /** Tag visibility (Feature B) — keys turned OFF. Default-on when absent. */
  disabledTagKeys?: Set<string>;
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

export function ShipToCard({
  shipToName,
  shipToCode,
  shipToArea,
  shipToDeliveryType,
  isOverride,
  signals,
  disabledTagKeys,
}: ShipToCardProps): JSX.Element {
  const dotClass = getDeliveryDotClass(shipToDeliveryType);

  // Gate the "captured" badge on the same tag-visibility mechanism (default-on:
  // hidden only when mail_orders.captured is explicitly disabled).
  const showCaptured = isOverride && !(disabledTagKeys?.has(MO_TAG.captured) ?? false);

  const cardClasses = isOverride
    ? "relative bg-white border border-gray-200 rounded-lg pl-[14px] pr-3 py-2.5 before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:bg-amber-500 before:rounded-sm"
    : "relative bg-white border border-gray-200 rounded-lg px-3 py-2.5";

  const showCode = !!shipToCode;
  const showArea = !!shipToArea;
  const showRegion = !!shipToDeliveryType;
  const hasDetail = showCode || showArea || showRegion;

  return (
    <div className={cardClasses}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[9.5px] font-semibold tracking-[0.06em] uppercase text-gray-400">
          Ship to
        </span>
        {showCaptured && (
          <span
            className="inline-flex items-center gap-[3px] h-4 px-[5px] text-[9.5px] font-semibold rounded border bg-amber-50 border-amber-200 text-amber-700"
            title="Ship-to captured from email remark"
          >
            ⚑ captured
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 mb-[3px]">
        <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-[14.5px] font-bold text-gray-900 tracking-tight truncate">
          {shipToName || "—"}
        </span>
      </div>

      {hasDetail && (
        <div className="flex items-center gap-2 text-[11.5px] text-gray-500">
          {showCode && (
            <span className="font-mono text-[11px] px-1.5 py-px rounded border bg-gray-100 text-gray-700 border-gray-200">
              {shipToCode}
            </span>
          )}
          {showCode && showArea && <span>·</span>}
          {showArea && <span>{shipToArea}</span>}
          {(showCode || showArea) && showRegion && <span>·</span>}
          {showRegion && <span className="text-[11px]">{shipToDeliveryType}</span>}
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
