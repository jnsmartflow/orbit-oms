// lib/trips/redelivery-reasons.ts
//
// The re-delivery REASON vocabulary — PURE, so the Floor dialog (a client
// component) and the server (lib/trips/redelivery.ts, which imports prisma) read
// ONE list. chk_trip_redeliveries_reason is the backstop: a new reason = ALTER
// the CHECK first, then add it here (CORE §3 status-string rule).

/** The reasons chk_trip_redeliveries_reason admits, in display order. */
export const REDELIVERY_REASONS = ["site_closed", "wrong_dispatch"] as const;
export type RedeliveryReason = (typeof REDELIVERY_REASONS)[number];

export const REDELIVERY_REASON_LABELS: Record<RedeliveryReason, string> = {
  site_closed: "Shop / site closed",
  wrong_dispatch: "Wrong dispatch",
};

export function isRedeliveryReason(value: unknown): value is RedeliveryReason {
  return typeof value === "string" && (REDELIVERY_REASONS as readonly string[]).includes(value);
}

/** The label for a stored reason; the raw value when unknown (an old row after a CHECK change). */
export function redeliveryReasonLabel(reason: string): string {
  return isRedeliveryReason(reason) ? REDELIVERY_REASON_LABELS[reason] : reason;
}
