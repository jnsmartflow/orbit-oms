// ── Order-cancel reasons — THE central list ────────────────────────────────
// Same spirit as lib/picking/findings-reasons.ts and lib/workflow-stages.ts:
// ONE place encoding a small closed vocabulary, so the reason sheet and the
// write route can never disagree about what a valid reason is. The sheet is
// built FROM this list, so the UI can never offer a value the API would reject.
//
// ✅ OWNER-LOCKED LIST (2026-08-20). These five, this order, these labels.
// They REPLACED a provisional set lifted from the retired Support board's
// cancel dialog (archive/2026-07-support/components/support/
// cancel-order-dialog.tsx) that shipped in 3a as a placeholder. Nothing had
// written a note against the old keys — the route was unreachable until the ⋯
// menu landed — so there was no data to migrate.
//
// ⚠ NO CHECK CONSTRAINT GUARDS THIS ONE — unlike findings-reasons.ts, whose
// two strings are enforced by a live chk_pick_findings_reason that Prisma
// cannot see. A cancel reason lands in a free TEXT note column
// (order_status_logs.note), so adding or renaming a reason needs NO Supabase
// ALTER and NO migration: edit this file, done. Do not copy that file's
// three-step ALTER ritual across; it does not apply here.
//
// ⚠ WHAT *IS* PERMANENT: order_status_logs is INSERT-ONLY — one row per action,
// never updated. A label change affects only NEW rows; rows already written
// keep the words they were written with, which is correct for an audit trail.
//
// Pure constants, zero imports — safe from a client component and a route
// handler alike. Do not add a prisma import to this file.

/** The stored keys, in display order. The sheet must not re-sort them. */
export const CANCEL_REASONS = [
  "customer_cancelled",
  "wrong_order",
  "duplicate_bill",
  "pick_delete",
  "other",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * What the floor sees, and what is written into the log note.
 *
 * ⚠ THE LABEL IS THE STORED TEXT, not the key. `order_status_logs.note` is read
 * straight onto the Floor Cancelled tab's "Reason" column
 * (components/floor/cancelled-tab.tsx), so a note reading
 * "Cancelled — customer_cancelled" would put a snake_case key in front of an
 * operator. The KEY is the wire value (stable, greppable); the LABEL is what a
 * human reads.
 */
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  customer_cancelled: "Customer cancelled",
  wrong_order:        "Wrong order",
  duplicate_bill:     "Duplicate bill",
  pick_delete:        "Pick delete",
  other:              "Other",
};

/**
 * Does this reason REQUIRE a free-text remark?
 *
 * 🔴 ONE OWNER FOR THE RULE, TWO ENFORCERS WITH DIFFERENT JOBS.
 * "Other" on its own records nothing — it is the absence of a reason wearing a
 * label — so the remark is what makes it an explanation. Both the route and the
 * sheet import THIS function rather than re-testing `reason === "other"`:
 *   - app/api/picking/cancel/route.ts REJECTS with a 400. It is the source of
 *     truth; the rule holds against curl, a stale client, or a future caller.
 *   - the sheet only DISABLES its confirm button, so the supervisor never
 *     reaches that 400 in the first place.
 * That is not two sources of truth — it is one rule, enforced server-side and
 * previewed client-side. If a sixth reason ever needs a mandatory remark, this
 * function is the only edit.
 */
export function cancelRequiresNote(reason: CancelReason): boolean {
  return reason === "other";
}

/**
 * Runtime guard — the ONLY thing between a request body and the log write.
 * Every write path must call this BEFORE any DB work so a bad value comes back
 * as a clean 400 rather than being silently recorded as a reason nobody chose.
 */
export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === "string" && (CANCEL_REASONS as readonly string[]).includes(value);
}

/** Ready-made {value,label} pairs for the reason sheet. Order follows
 *  CANCEL_REASONS. */
export const CANCEL_REASON_OPTIONS: { value: CancelReason; label: string }[] =
  CANCEL_REASONS.map((value) => ({ value, label: CANCEL_REASON_LABELS[value] }));

/** Label for a stored key, tolerant of anything unexpected (a reason retired
 *  after rows were written with it) — renders the raw string rather than
 *  blanking the line. Same tolerance findingReasonLabel() has. */
export function cancelReasonLabel(reason: string): string {
  return isCancelReason(reason) ? CANCEL_REASON_LABELS[reason] : reason;
}

/**
 * The note text written to order_status_logs. ONE builder, so every caller
 * produces identically-shaped notes and the Cancelled tab's Reason column stays
 * readable.
 *
 * Shape: `Cancelled — {label}`, plus ` · {note}` when free text was supplied.
 *
 * ⚠ For `other` the label alone says nothing, so the remark is mandatory
 * (cancelRequiresNote above) and the note always reads
 * "Cancelled — Other · {what actually happened}".
 *
 * ⚠ Deliberately does NOT encode which SCREEN cancelled the bill. Floor's
 * fallback string is "Cancelled from floor" (app/api/floor/actions/route.ts),
 * which does — but the actor is already on the log row (`changedById`, rendered
 * as "by {user}" on the Cancelled tab), so repeating the source inside the
 * human-facing reason text would spend the column's width on something already
 * on screen.
 */
export function buildCancelNote(reason: CancelReason, note?: string | null): string {
  const trimmed = typeof note === "string" ? note.trim() : "";
  const base = `Cancelled — ${CANCEL_REASON_LABELS[reason]}`;
  return trimmed.length > 0 ? `${base} · ${trimmed}` : base;
}

/** Free-text remark cap. The column is unbounded TEXT; this is the API/UI
 *  bound, matching the 500-char convention the app's other reason/remark
 *  fields use (RemoveObdModal, PauseJobModal — CLAUDE_UI.md §36/§39).
 *  The sheet's live counter reads THIS constant — never its own number. */
export const CANCEL_NOTE_MAX = 500;
