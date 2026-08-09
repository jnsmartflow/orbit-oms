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

// ── Manufacturing month / year — the old_mfg fields (2026-08-08) ────────────
// Lives here, beside the reason list, because these two columns exist ONLY for
// `reason === 'old_mfg'`: they are part of what that reason MEANS, not a
// general property of a finding. Both consumers (the popup and the two write
// routes) already import from this module, so one home keeps the UI from ever
// offering a value the API would reject.

/** Jan-Dec, index 0 = month 1. Display labels only — the DB stores the integer. */
export const MFG_MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** How many years the picker's dropdown offers, current year inclusive. */
export const MFG_YEAR_WINDOW = 6;

/**
 * The years the UI offers, newest first: the current year and the five before
 * it. Computed at call time from the caller's clock rather than frozen into a
 * constant, so the list does not silently go stale on 1 January.
 */
export function mfgYearOptions(now: Date = new Date()): number[] {
  const current = now.getFullYear();
  return Array.from({ length: MFG_YEAR_WINDOW }, (_, i) => current - i);
}

/**
 * "Mar 2024" for the compact note — THE one formatter, shared by every screen
 * that prints a finding (both picking boards via FindingNote, and the billing
 * detail panel's own note). Two copies of this would drift on the separator or
 * the month casing while sitting side by side in the same workflow.
 *
 * Returns null — not "" and not a partial string — unless BOTH parts are
 * present and the month is in range. That is not defensive padding: `old_mfg`
 * findings recorded BEFORE these columns existed (2026-08-08) have null
 * month/year and are still live rows, and a re-import cannot backfill them.
 * Callers render the date only when this returns non-null, so a legacy row
 * reads "Found 9 · Old MFG" — the truth about it — instead of
 * "Found 9 · Old MFG · undefined NaN".
 *
 * Month/year are NOT validated against each other or against today: the whole
 * point of the field is to record a date read off a tin, which may legitimately
 * be older than any window this app would offer.
 */
export function mfgLabel(month: number | null, year: number | null): string | null {
  if (month === null || year === null) return null;
  if (!isMfgMonth(month)) return null;
  return `${MFG_MONTH_LABELS[month - 1]} ${year}`;
}

/** 1-12. Mirrors the live chk_pick_findings_mfg_month CHECK, so a bad value
 *  comes back as a clean 400 instead of a raw constraint violation. */
export function isMfgMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

/**
 * A SANITY bound, deliberately WIDER than `mfgYearOptions()` offers.
 *
 * ⚠ Do NOT tighten this to the UI's 6-year window. That window rolls forward
 * every 1 January, so an old_mfg finding recorded in December against the
 * oldest offered year would start rejecting its own re-save a few weeks later —
 * the supervisor would be unable to correct a typo on a row he is looking at.
 * The narrow list is a convenience for typing; this is the only thing that has
 * to be true. There is no DB constraint on the year for the same reason.
 */
export function isMfgYear(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= 2000 && value <= new Date().getFullYear() + 1;
}
