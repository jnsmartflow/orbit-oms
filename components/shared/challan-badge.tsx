// components/shared/challan-badge.tsx
//
// The CHALLAN pill (Challan orders slice 4, 2026-10-07 — design
// web-update-2026-10-06-challan-orders.md M1; mockup docs/mockups/challan-orders/badges.html).
// Marks an ORB order (orders.isChallanOrder): goods sent on an Orbit challan with
// no SAP bill yet. The ORB number in the OBD slot says WHICH challan; this pill
// says WHY the row reads differently.
//
// CLAUDE_UI §3 Semantic "Split" row — purple-50 / purple-200 / purple-700 —
// capitals, kept apart from the grey GIFT chip (M1). Same size and shape as
// GiftBadge / HandBadge / ColourWorkBadge so it sits beside them as a sibling.
//
// ONE owner — every surface imports this; no inline copies.

export function ChallanBadge() {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border border-purple-200 bg-purple-50 px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-purple-700"
      aria-label="Challan order — goods sent without a SAP bill"
      title="Challan order — goods sent without a SAP bill yet"
    >
      CHALLAN
    </span>
  );
}
