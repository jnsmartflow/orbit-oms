// components/shared/obd-badge.tsx
//
// The OBD pill (2026-10-16). Marks a bill that came in through the Import
// window's OBD source (orders.isObdImport, schema v27.68 — the SAP paste with
// the IN53 shipping-point skip turned off). A standing fact about the bill, so
// it sits in the same run as CHALLAN / TINT / GIFT / HAND. A bill can carry
// both CHALLAN and OBD.
//
// 🔴 SOLID, NEVER PALE. `data.plum` #86198F with white text (8.24:1). A pale
// plum pill (#FDF4FF ground) is the same lavender as CHALLAN's purple-50
// (ΔE 1.5), so the two would differ only by their word — CLAUDE_UI §2.1.
// Same size and shape as ChallanBadge so the two sit side by side as siblings.
//
// ONE owner — every surface imports this; no inline copies.

export function ObdBadge() {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border border-data-plum bg-data-plum px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-white"
      aria-label="OBD import — came in through the OBD paste"
      title="OBD import — came in through the OBD paste"
    >
      OBD
    </span>
  );
}
