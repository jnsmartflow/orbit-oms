// ── Order-cancel reasons — THE central list ────────────────────────────────
// Same spirit as lib/picking/findings-reasons.ts and lib/workflow-stages.ts:
// ONE place encoding a small closed vocabulary, so the reason sheet and the
// write route can never disagree about what a valid reason is. The sheet is
// built FROM this list, so the UI can never offer a value the API would reject.
//
// 🔴 PROVISIONAL LIST — SMART FLOW MUST CONFIRM THE FIVE BEFORE 3b SHIPS.
// The build checklist records "Mockup — locked, 5 reasons", but the mockup is
// not in this repo (searched the full tree 2026-08-20, including
// docs/prompts/drafts/ where the duplicate-SO mockup actually lives). The five
// below are TAKEN FROM THE REAL PRECEDENT IN THIS CODEBASE, not invented:
// CANCEL_REASONS in archive/2026-07-support/components/support/
// cancel-order-dialog.tsx, which is the retired Support board's cancel dialog —
// six entries, being these five plus a free-text "Other". Five-without-Other
// matching the locked count is suggestive, NOT proof. Correct the labels here
// and nothing else changes.
//
// ⚠ WHY GETTING THIS WRONG IS CHEAP *NOW* AND EXPENSIVE *LATER*. The chosen
// reason is written into order_status_logs.note (app/api/picking/cancel), and
// that table is INSERT-ONLY — one row per action, never updated. A wrong label
// that reaches production is wrong in the audit trail forever. Today nothing
// can reach the route from the UI (3b builds the menu), so the list is still
// free to change; the moment 3b ships it is not.
//
// ⚠ NO CHECK CONSTRAINT GUARDS THIS ONE — unlike findings-reasons.ts. A cancel
// reason lands in a free TEXT note column, not in a constrained enum-ish
// column, so adding or renaming a reason needs NO Supabase ALTER and NO
// migration: edit this file, done. Do not copy findings-reasons.ts's
// three-step ALTER ritual across; it does not apply here.
//
// Pure constants, zero imports — safe from a client component and a route
// handler alike. Do not add a prisma import to this file.

/** The stored keys, in display order. */
export const CANCEL_REASONS = [
  "customer_cancelled",
  "duplicate_order",
  "material_unavailable",
  "address_route_issue",
  "credit_hold",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * What the floor sees, and what is written into the log note.
 *
 * ⚠ THE LABEL IS THE STORED TEXT, not the key. `order_status_logs.note` is
 * read straight onto the Floor Cancelled tab's "Reason" column
 * (components/floor/cancelled-tab.tsx), so a note reading
 * "Cancelled — customer_cancelled" would put a snake_case key in front of an
 * operator. The KEY is the wire value (stable, greppable); the LABEL is what
 * a human reads. Renaming a label changes only NEW rows — old ones keep the
 * words they were written with, which is correct for an audit trail.
 */
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  customer_cancelled:   "Customer requested cancellation",
  duplicate_order:      "Duplicate order",
  material_unavailable: "Material not available",
  address_route_issue:  "Address / route issue",
  credit_hold:          "Credit hold",
};

/**
 * Runtime guard — the ONLY thing between a request body and the log write.
 * Every write path must call this BEFORE any DB work so a bad value comes back
 * as a clean 400 rather than being silently recorded as a cancellation reason
 * nobody chose.
 */
export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === "string" && (CANCEL_REASONS as readonly string[]).includes(value);
}

/** Ready-made {value,label} pairs for the 3b reason sheet. Order follows
 *  CANCEL_REASONS — the sheet must not re-sort them. */
export const CANCEL_REASON_OPTIONS: { value: CancelReason; label: string }[] =
  CANCEL_REASONS.map((value) => ({ value, label: CANCEL_REASON_LABELS[value] }));

/** Label for a stored key, tolerant of anything unexpected (a reason retired
 *  after rows were written with it) — renders the raw string rather than
 *  blanking the line. Same tolerance findingReasonLabel() has. */
export function cancelReasonLabel(reason: string): string {
  return isCancelReason(reason) ? CANCEL_REASON_LABELS[reason] : reason;
}

/**
 * The note text written to order_status_logs. ONE builder, so the Picking route
 * and any future caller produce identically-shaped notes and the Cancelled
 * tab's Reason column stays readable.
 *
 * Shape: `Cancelled — {label}` , plus ` · {note}` when free text was supplied.
 *
 * ⚠ Deliberately does NOT encode which SCREEN cancelled the bill. Floor's
 * existing fallback string is "Cancelled from floor"
 * (app/api/floor/actions/route.ts), which does — but the actor is already on
 * the log row (`changedById`, rendered as "by {user}" on the Cancelled tab),
 * so repeating the source inside the human-facing reason text would spend the
 * column's width on something already on screen.
 */
export function buildCancelNote(reason: CancelReason, note?: string | null): string {
  const trimmed = typeof note === "string" ? note.trim() : "";
  const base = `Cancelled — ${CANCEL_REASON_LABELS[reason]}`;
  return trimmed.length > 0 ? `${base} · ${trimmed}` : base;
}

/** Free-text note cap. The column is unbounded TEXT; this is a UI/API sanity
 *  bound matching the 500-char convention the other reason/remark fields in
 *  this app use (RemoveObdModal, PauseJobModal — CLAUDE_UI.md §36/§39). */
export const CANCEL_NOTE_MAX = 500;
