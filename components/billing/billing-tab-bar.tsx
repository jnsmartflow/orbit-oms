"use client";

// Billing v2 — the Orders | Picking tab bar (mockup docs/mockups/billing/
// billing-final-mockup.html, `.panetabs`).
//
// Copies Floor's tab pill EXACTLY (components/floor/floor-page.tsx tabPill):
// gray-900 bottom border + gray-900 count chip when active, transparent border
// + gray-100 chip when not. Do not restyle one without the other.
//
// The Picking count is LIVE off /api/billing/picking/marker, so the badge moves
// while the operator is still on the Orders tab — that is the whole point of the
// badge. TEAL: the live dot is the ONLY teal element on this bar (CLAUDE_UI §1).

import { useCallback, useEffect, useRef, useState } from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

export type BillingTab = "orders" | "picking";

const MARKER_URL = "/api/billing/picking/marker";

export function BillingTabBar({
  active,
  onChange,
  ordersCount,
  rightSlot,
}: {
  active: BillingTab;
  onChange: (tab: BillingTab) => void;
  ordersCount: number;
  /**
   * Right-aligned controls for this row — the date stepper and Filter, which on
   * the billing face live here instead of the header's Row 2. Mirrors where
   * Floor puts its own right-side row controls (floor-page.tsx:618, `ml-auto`).
   * Omitted → the live caption keeps the right edge, exactly as before.
   */
  rightSlot?: React.ReactNode;
}) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  // Guards against a late response from a superseded request overwriting a
  // newer count (the poll and a manual refresh can overlap).
  const reqRef = useRef(0);

  const refreshCount = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(MARKER_URL, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (seq !== reqRef.current) return;
      if (typeof body.count === "number") setPendingCount(body.count);
    } catch {
      // Silent, like the marker hook itself — this runs all day and a blip
      // must not produce a toast or a console full of noise.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // The marker tells us WHEN to re-read; refreshCount reads the count itself
  // from the same endpoint. Reusing the shared hook rather than hand-rolling a
  // second poller keeps the tab-hidden pause, the no-overlap guard and the
  // silent-failure behaviour (lib/hooks/use-picking-marker.ts). `scope` is
  // required by its type and ignored by the billing marker route, which serves
  // one fixed set — the same arrangement Floor uses (floor-page.tsx:493).
  usePickingMarker({
    scope: "openPending",
    url: MARKER_URL,
    onChange: () => void refreshCount(),
  });

  function pill(key: BillingTab, label: string, count: number | null, live: boolean) {
    const on = active === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        className={`flex items-center gap-1.5 border-b-2 py-3 text-[12px] ${
          on
            ? "border-gray-900 font-bold text-gray-900"
            : "border-transparent text-gray-400 hover:text-gray-600"
        }`}
      >
        {live && (
          <span
            aria-hidden
            className="h-[6px] w-[6px] rounded-full bg-teal-600 ring-2 ring-teal-600/15"
          />
        )}
        {label}
        <span
          className={`rounded px-1.5 py-px text-[10px] font-bold ${
            on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
          }`}
        >
          {count ?? "–"}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
      {pill("orders", "Orders", ordersCount, false)}
      {pill("picking", "Picking", pendingCount, true)}
      {/* Caption keeps its place; `ml-auto` pushes the pair to the right edge so
          the controls sit outermost and nothing overlaps. When rightSlot is
          omitted the caption alone carries ml-auto, as before. */}
      <span className="ml-auto text-[11px] text-gray-400">
        updates live as picks are checked
      </span>
      {rightSlot && <div className="flex items-center gap-2 py-1.5">{rightSlot}</div>}
    </div>
  );
}
