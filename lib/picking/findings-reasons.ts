// ── Picking-finding reasons — THE central list ─────────────────────────────
// Same spirit as lib/workflow-stages.ts: one place that encodes a small closed
// vocabulary, so every consumer asks IT rather than hand-maintaining its own
// array. Consumers today: the picker's record popup + POST
// /api/picking/findings/report. Step 5's supervisor screen imports from here
// too — do not re-declare the pair anywhere else.
//
// 🔴 THESE TWO STRINGS ARE ENFORCED BY A LIVE CHECK CONSTRAINT PRISMA CANNOT
// SEE: chk_pick_findings_reason on pick_findings restricts `reason` to exactly
// 'short_quantity' | 'old_mfg' (CLAUDE_CORE.md §7.4). Prisma has no idea it
// exists, so an unlisted value does NOT fail type-check or validation — it
// reaches Postgres and comes back as a raw constraint-violation error.
// Adding a THIRD reason therefore means, in this order:
//   1. ALTER the constraint in the Supabase SQL Editor (CORE §3 — never a
//      migration, never db push),
//   2. add it here,
//   3. and only then use it in code.
// Same discipline as chk_pick_assignments_status and the third picking status
// value that was deliberately never added (CLAUDE_PICKING.md §7).
//
// Pure constants, zero imports — safe from both a client component and a route
// handler. Do not add a prisma import to this file.

/** The DB strings, in display order. */
export const FINDING_REASONS = ["short_quantity", "old_mfg"] as const;

export type FindingReason = (typeof FINDING_REASONS)[number];

/** What the floor sees. The DB never stores these — they are labels only. */
export const FINDING_REASON_LABELS: Record<FindingReason, string> = {
  short_quantity: "Short quantity",
  old_mfg:        "Old MFG",
};

/**
 * Runtime guard — the ONLY thing standing between a request body and the live
 * CHECK constraint. Every write path must call this BEFORE the insert so a bad
 * value comes back as a clean 400 instead of a raw Postgres error.
 */
export function isFindingReason(value: unknown): value is FindingReason {
  return typeof value === "string" && (FINDING_REASONS as readonly string[]).includes(value);
}

/** Ready-made {value,label} pairs for a <select>. Order follows FINDING_REASONS. */
export const FINDING_REASON_OPTIONS: { value: FindingReason; label: string }[] =
  FINDING_REASONS.map((value) => ({ value, label: FINDING_REASON_LABELS[value] }));

/** Label for a stored value, tolerant of anything unexpected already in the DB
 *  (a row written before a reason was retired, say) — renders the raw string
 *  rather than blanking the line. */
export function findingReasonLabel(reason: string): string {
  return isFindingReason(reason) ? FINDING_REASON_LABELS[reason] : reason;
}
