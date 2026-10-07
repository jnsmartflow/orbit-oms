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
import {
  useBillingMarkerSubscription,
  useBillingPrintMarkerSubscription,
  useBillingTelephonicMarkerSubscription,
} from "@/components/billing/billing-marker-provider";
import { useBillingLiveCounts } from "@/components/billing/billing-live";
import { ChallanCountProbe } from "@/components/challan-orders/use-challan-count";

export type BillingTab = "orders" | "picking" | "print" | "telephonic" | "pick_delete" | "challan_orders";

/** The Pick delete pill's count (2026-09-27) — same-SO groups waiting for a decision. */

const MARKER_URL = "/api/billing/picking/marker";
/** The Print pill's count (slice 9) — trips with copy work outstanding. */
const PRINT_MARKER_URL = "/api/billing/print/marker";
/** The Telephonic pill's count (2026-09-22) — tags still waiting for their OBD. */
const TELEPHONIC_MARKER_URL = "/api/billing/telephonic/marker";

export function BillingTabBar({
  active,
  onChange,
  ordersCount,
  rightSlot,
  showPicking = true,
  showPrint = false,
  showTelephonic = false,
  showPickDelete = false,
  showChallanOrders = false,
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
  /**
   * Does this viewer hold `billing_print`/canView? (Slice 9, 2026-09-15.) The
   * same two meanings as `showPicking`: no Print pill, and NO request to the
   * Print marker. Defaults FALSE — unlike `showPicking` — because a new tab must
   * be granted to appear, never appear by default.
   */
  showPrint?: boolean;
  /**
   * Does this viewer hold `billing_telephonic`/canView? (2026-09-22.) The same
   * two meanings as `showPrint` — no pill, and NO request to its marker — and
   * the same FALSE default.
   */
  showTelephonic?: boolean;
  /**
   * Does this viewer hold `billing_pick_delete`/canView? (2026-09-27.) The same
   * two meanings as `showTelephonic` — no pill, and NO request to its marker —
   * and the same FALSE default.
   */
  showPickDelete?: boolean;
  /**
   * Does this viewer hold `challan_orders`/canView? (Challan orders slice 5,
   * 2026-10-07.) The shared Challan orders screen. Same two meanings as
   * `showTelephonic` — no pill, and NO request to its marker (the count probe is
   * only mounted when true) — and the same FALSE default. Count = Not billed.
   */
  showChallanOrders?: boolean;
}) {
  // LIVE FEED (2b-ii): while the Billing desk is on the change feed the pills read the
  // root's counts (sync answers + one marker read at start) and NOTHING below fetches a
  // marker. Off the feed `live` is null and this bar is exactly what it was.
  const live = useBillingLiveCounts();
  const liveRef = useRef(live);
  liveRef.current = live;
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [printCount, setPrintCount] = useState<number | null>(null);
  const [telephonicCount, setTelephonicCount] = useState<number | null>(null);
  // Challan orders — Not billed, off the screen's own marker (ChallanCountProbe).
  const [challanCount, setChallanCount] = useState<number | null>(null);
  const printReqRef = useRef(0);
  const telephonicReqRef = useRef(0);

  // The Telephonic count — the same shape as refreshPrintCount, on its own marker.
  const refreshTelephonicCount = useCallback(async () => {
    if (!showTelephonic) return;
    if (liveRef.current) return; // live: the count comes from the feed
    const seq = ++telephonicReqRef.current;
    try {
      const res = await fetch(TELEPHONIC_MARKER_URL, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (seq !== telephonicReqRef.current) return;
      if (typeof body.count === "number") setTelephonicCount(body.count);
    } catch {
      // Silent, like refreshCount.
    }
  }, [showTelephonic]);

  useEffect(() => {
    void refreshTelephonicCount();
  }, [refreshTelephonicCount]);

  useBillingTelephonicMarkerSubscription(refreshTelephonicCount);

  // The Print count — the same shape as refreshCount below, on its own marker.
  const refreshPrintCount = useCallback(async () => {
    if (!showPrint) return;
    if (liveRef.current) return; // live: the count comes from the feed
    const seq = ++printReqRef.current;
    try {
      const res = await fetch(PRINT_MARKER_URL, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (seq !== printReqRef.current) return;
      if (typeof body.count === "number") setPrintCount(body.count);
    } catch {
      // Silent, like refreshCount.
    }
  }, [showPrint]);

  useEffect(() => {
    void refreshPrintCount();
  }, [refreshPrintCount]);

  useBillingPrintMarkerSubscription(refreshPrintCount);
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
    if (liveRef.current) return; // live: the count comes from the feed
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

  // Leaving the feed (switch off / errors): the legacy polls only take a silent baseline, so
  // re-read each count once here or the pills would keep their last live numbers.
  const wasLive = useRef(false);
  useEffect(() => {
    if (live !== null) {
      wasLive.current = true;
      return;
    }
    if (!wasLive.current) return;
    wasLive.current = false;
    void refreshCount();
    void refreshPrintCount();
    void refreshTelephonicCount();
  }, [live, refreshCount, refreshPrintCount, refreshTelephonicCount]);
  const shownPending = live?.picking ?? pendingCount;
  const shownPrint = live?.print ?? printCount;
  const shownTelephonic = live?.telephonic ?? telephonicCount;

  function pill(key: BillingTab, label: string, count: number | null, live: boolean, hideZero = false) {
    const on = active === key;
    // Telephonic only: no chip at all while nothing is waiting (or before the
    // first count lands) — an always-zero badge on a list that is usually empty
    // is noise. The other pills keep their chip exactly as before.
    const showChip = !hideZero || (count !== null && count > 0);
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
        {showChip && (
          <span
            className={`rounded px-1.5 py-px text-[10px] font-bold ${
              on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {count ?? "–"}
          </span>
        )}
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
      {showPicking && pill("picking", "Picking", shownPending, true)}
      {/* Print (slice 9) — gated on `billing_print`/canView, a sibling in the
          same row like Picking. Its count is trips with copy work outstanding. */}
      {showPrint && pill("print", "Print", shownPrint, true)}
      {/* Telephonic (2026-09-22) — gated on `billing_telephonic`/canView, a
          sibling in the same row. Its count is tags still waiting for their OBD;
          the chip is hidden at 0. No live dot: nothing on it moves by itself
          often enough to earn one. */}
      {showTelephonic && pill("telephonic", "Telephonic", shownTelephonic, false, true)}
      {/* Pick delete — gated on `billing_pick_delete`/canView. HISTORY ONLY since
          2026-09-28: a plain label like Telephonic, no count and no yellow — the
          groups themselves are decided in the blocking popup
          (components/billing/billing-pick-delete-popup.tsx), on every tab. */}
      {showPickDelete && pill("pick_delete", "Pick delete", null, false, true)}
      {/* Challan orders (2026-10-07, slice 5) — gated on `challan_orders`/canView, a
          sibling after Pick delete. Count = challans not billed yet, hidden at 0.
          The probe that feeds it is mounted ONLY for a holder (no 403 polling). */}
      {showChallanOrders && pill("challan_orders", "Challan orders", challanCount, false, true)}
      {showChallanOrders && <ChallanCountProbe onCount={setChallanCount} />}
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
