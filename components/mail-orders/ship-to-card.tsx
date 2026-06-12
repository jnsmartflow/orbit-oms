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
  // Bill-to fallback identity — shown INSTEAD of the captured ship-to when the
  // "captured" tag is OFF and this order has an override. Display only; the
  // stored override is never changed.
  billToName?: string | null;
  billToCode?: string | null;
  billToArea?: string | null;
  billToDeliveryType?: string | null;
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
  billToName,
  billToCode,
  billToArea,
  billToDeliveryType,
}: ShipToCardProps): JSX.Element {
  const capturedDisabled = disabledTagKeys?.has(MO_TAG.captured) ?? false;

  // When "captured" is OFF, an overridden order falls back to showing the
  // bill-to customer's address (display only — stored override is untouched).
  // The card then renders like a normal (non-override) ship-to: no amber bar,
  // no captured pill, bill-to identity.
  const useBillToFallback = isOverride && capturedDisabled;

  const effectiveName        = useBillToFallback ? (billToName ?? "") : shipToName;
  const effectiveCode        = useBillToFallback ? (billToCode ?? null) : shipToCode;
  const effectiveArea        = useBillToFallback ? (billToArea ?? null) : shipToArea;
  const effectiveDeliveryType = useBillToFallback ? (billToDeliveryType ?? null) : shipToDeliveryType;

  const dotClass = getDeliveryDotClass(effectiveDeliveryType);

  // Captured pill shows only for a real override while the tag is ON.
  const showCaptured = isOverride && !capturedDisabled;
  // Amber override styling only when we're actually showing the override.
  const showOverrideStyling = isOverride && !useBillToFallback;

  const cardClasses = showOverrideStyling
    ? "relative bg-white border border-gray-200 rounded-lg pl-[14px] pr-3 py-2.5 before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:bg-amber-500 before:rounded-sm"
    : "relative bg-white border border-gray-200 rounded-lg px-3 py-2.5";

  const showCode = !!effectiveCode;
  const showArea = !!effectiveArea;
  const showRegion = !!effectiveDeliveryType;
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
          {effectiveName || "—"}
        </span>
      </div>

      {hasDetail && (
        <div className="flex items-center gap-2 text-[11.5px] text-gray-500">
          {showCode && (
            <span className="font-mono text-[11px] px-1.5 py-px rounded border bg-gray-100 text-gray-700 border-gray-200">
              {effectiveCode}
            </span>
          )}
          {showCode && showArea && <span>·</span>}
          {showArea && <span>{effectiveArea}</span>}
          {(showCode || showArea) && showRegion && <span>·</span>}
          {showRegion && <span className="text-[11px]">{effectiveDeliveryType}</span>}
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
