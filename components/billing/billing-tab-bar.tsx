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
import { useBillingMarkerSubscription } from "@/components/billing/billing-marker-provider";

export type BillingTab = "orders" | "picking";

const MARKER_URL = "/api/billing/picking/marker";

export function BillingTabBar({
  active,
  onChange,
  ordersCount,
  rightSlot,
  showPicking = true,
}: {
  active: BillingTab;
  onChange: (tab: BillingTab) => void;
  /**
   * Orders still NEEDING ACTION — not punched. NOT a total, and not the rail's
   * pending group either (that one keeps recently-punched rows visible and would
   * make this badge overcount for a few seconds after each punch). Both tab
   * counts read the same way: work outstanding, not rows on screen.
   */
  ordersCount: number;
  /**
   * Right-aligned controls for this row — the date stepper and Filter, which on
   * the billing face live here instead of the header's Row 2. Mirrors where
   * Floor puts its own right-side row controls (floor-page.tsx:618, `ml-auto`).
   * Omitted → the live caption keeps the right edge, exactly as before.
   */
  rightSlot?: React.ReactNode;
  /**
   * Does this viewer hold `billing_picking`/canView? (2026-09-11.)
   * 🔴 The BILLING Picking tab's key, not the floor board's `picking`.
   *
   * FALSE means two things, and BOTH matter:
   *   1. no Picking pill — the row is Orders plus `rightSlot`;
   *   2. NO REQUEST TO THE MARKER ENDPOINT, ever. The count fetch below runs on
   *      mount and again on every marker tick, independently of which tab is
   *      open, because the badge has to stay live while the operator works in
   *      Orders. Ungated, a viewer without the key would sit here collecting a
   *      403 every 30 seconds for their whole shift.
   *
   * The shared provider (billing-marker-provider.tsx) is disabled for the same
   * viewer by mail-orders-page.tsx, which stops the POLL. This prop stops the
   * bar's own mount-time fetch, which that provider does not own. Both are
   * needed; neither is sufficient.
   *
   * Defaults TRUE so the prop is purely additive — the bar behaves exactly as
   * it did for every existing caller. The one live caller (review-view.tsx)
   * always passes it explicitly.
   */
  showPicking?: boolean;
}) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  // Guards against a late response from a superseded request overwriting a
  // newer count (the poll and a manual refresh can overlap).
  const reqRef = useRef(0);

  const refreshCount = useCallback(async () => {
    // 🔴 THE GUARD THAT KEEPS A NON-HOLDER OFF THE WIRE. Checked here rather
    // than at each of the two call sites (the mount effect and the marker
    // subscription) so there is ONE place to be wrong. `showPicking` is in the
    // dependency list, so a grant arriving mid-session starts the count on the
    // next render rather than needing a reload.
    if (!showPicking) return;
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
  }, [showPicking]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // The marker tells us WHEN to re-read; refreshCount reads the count itself
  // from the same endpoint.
  //
  // This used to run its OWN usePickingMarker. It now subscribes to the ONE
  // poll owned by BillingMarkerProvider (2026-08-10) — because BillingPickingTab
  // is a sibling that ran a second, independent timer against this same URL, so
  // the Picking tab was probing twice for one answer. All the behaviour that
  // mattered still comes from the same hook underneath: tab-hidden pause,
  // no-overlap guard, silent failure.
  useBillingMarkerSubscription(refreshCount);

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
            className="h-[6px] w-[6px] rounded-full bg-ok ring-2 ring-ok/15"
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
      {/* Gated on `billing_picking`/canView (2026-09-11). Without it the row is
          Orders plus `rightSlot` — still the right shape, because this bar also
          carries the date stepper, Filter and shortcuts on the billing face.
          ⚠ The pill is a SIBLING inside the existing flex row, not wrapped in a
          new div (§23.1), so the granted layout is byte-identical. */}
      {showPicking && pill("picking", "Picking", pendingCount, true)}
      {/* ⚠ `ml-auto` lives HERE now. It used to sit on a caption span that ran
          between the pills and this slot; removing that span without moving the
          class would have left the controls butted against the Picking pill
          instead of pinned to the right edge. With rightSlot omitted the row is
          just the two pills, left-aligned — which is correct, there is nothing
          left to push. */}
      {rightSlot && <div className="ml-auto flex items-center gap-2 py-1.5">{rightSlot}</div>}
    </div>
  );
}
