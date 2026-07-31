"use client";

// Billing v2 — the ⓘ metadata popover on the order ribbon.
//
// The summary line's descriptive facts (who ordered, when it arrived, who
// punched it) moved off the ribbon to make room for the action row. They are
// reference, not workflow — so they live one click away rather than occupying
// the busiest row on the screen.
//
// ⚠ NO NEW DATA SOURCE. Every value is passed in, already formatted, by
// review-view.tsx — the SAME strings MetaRibbon's summary line renders when the
// flag is off (soNameFormatted / receivedAtFormatted / punchedByName /
// punchedAtFormatted). Do not read from `order` here; two derivations drift.
//
// Close behaviour follows the existing popover pattern in review-view.tsx (the
// customer-code popover): outside mousedown closes, Escape closes.

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { BTN_BASE, BTN_OFF } from "@/components/billing/billing-action-ribbon";

export function BillingOrderInfo({
  soName,
  receivedAt,
  punchedByName,
  punchedAt,
}: {
  soName: string | null;
  receivedAt: string;
  punchedByName: string | null;
  punchedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The punched row appears only once the order is punched — both halves must
  // be present, matching MetaRibbon's own `punchedByName && punchedAt` guard.
  const showPunched = !!punchedByName && !!punchedAt;

  return (
    <span ref={boxRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Order details"
        aria-label="Order details"
        // Same BTN_BASE/BTN_OFF the Urgent/Hold/Slot buttons use, minus the
        // label — a square 27px icon button that sits on the same baseline as
        // the rest of the ribbon's controls instead of being a hair taller.
        className={`${BTN_BASE} ${BTN_OFF} w-[27px] justify-center px-0`}
      >
        <Info size={13} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-[31px] z-50 w-[260px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <Row label="Ordered by" value={soName} />
          <Row label="Received" value={receivedAt} />
          {showPunched && <Row label="Punched by" value={`${punchedByName} · ${punchedAt}`} />}
        </div>
      )}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value || value.trim().length === 0) return null;
  return (
    <div className="flex items-baseline gap-2 py-[3px]">
      <span className="w-[74px] flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[11.5px] text-gray-700">{value}</span>
    </div>
  );
}
