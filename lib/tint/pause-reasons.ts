// Shared pause-reason enum + humaniser. Used by:
//   - components/tint/tint-operator-content.tsx (Phase 4c/4d paused-card)
//   - components/tint/tint-manager-content.tsx  (Phase 4e Kanban summary)
//   - components/tint/tint-table-view.tsx       (Phase 4e table badge)
//   - components/tint/PauseHistoryModal.tsx     (Phase 4e per-event row)
//
// Values mirror the enum accepted by /api/tint/operator/pause (Phase 4a).
// Keep this module tiny — no extra deps so any consumer can import freely.

export type PauseReason =
  | "lunch_break"
  | "shift_end"
  | "machine_breakdown"
  | "material_shortage"
  | "urgent_priority";

export const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  lunch_break:       "Lunch break",
  shift_end:         "End of shift",
  machine_breakdown: "Machine breakdown",
  material_shortage: "Material shortage",
  urgent_priority:   "Urgent priority job",
};

export function humaniseReason(r: string | null | undefined): string {
  if (!r) return "—";
  return (PAUSE_REASON_LABELS as Record<string, string>)[r] ?? r;
}
