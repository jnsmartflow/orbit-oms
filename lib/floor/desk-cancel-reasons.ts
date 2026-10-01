// lib/floor/desk-cancel-reasons.ts — the DESK cancel reasons (2026-10-01, owner
// decision B — docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §J).
//
// The reasons the two DESK cancel forms offer — Floor's (components/floor/
// off-floor-dialog.tsx) and the Tint Manager's (that dialog on its routes, and
// board-stop-cancel-dialog.tsx) — and the two routes that write them validate:
// app/api/floor/actions (cancel) and app/api/tint/manager/cancel.
//
// 🔴 A SEPARATE LIST FROM PICKING'S, ON PURPOSE. lib/picking/cancel-reasons.ts
// CANCEL_REASONS is rendered WHOLE by the Picking cancel sheet
// (components/picking/cancel-sheet.tsx); adding "Material short" or "Wrong order
// by SO" there would change that screen. The owner chose a desk list instead.
// Picking's list, labels and sheet are untouched.
//
// 🔴 THE NOTE'S SHAPE IS STILL PICKING'S. buildDeskCancelNote writes
// "Cancelled — {Label}" + " · {remark}" by reading the prefix and separator OFF
// buildCancelNote's own output (the same derivation lib/floor/off-floor.ts
// parseCancelNote uses), so Floor's Cancelled tab parses a desk note exactly as
// it parses a picking one. Keys are stable wire values; labels are what lands in
// order_status_logs.note (insert-only — a relabel affects new rows only).
//
// Pure constants, no Prisma — safe in a client component and a route alike.

import { CANCEL_NOTE_MAX, CANCEL_REASON_LABELS, buildCancelNote } from "@/lib/picking/cancel-reasons";

/** The stored keys, in display order. Forms must not re-sort them. */
export const DESK_CANCEL_REASONS = [
  "pick_delete",
  "customer_cancelled",
  "wrong_order_by_so",
  "duplicate_bill",
  "material_short",
  "other",
] as const;

export type DeskCancelReason = (typeof DESK_CANCEL_REASONS)[number];

/** What a person reads, and what is written into the log note. */
export const DESK_CANCEL_REASON_LABELS: Record<DeskCancelReason, string> = {
  pick_delete:        "Pick delete",
  customer_cancelled: "Customer cancelled",
  wrong_order_by_so:  "Wrong order by SO",
  duplicate_bill:     "Duplicate bill",
  material_short:     "Material short",
  other:              "Other",
};

export function isDeskCancelReason(value: unknown): value is DeskCancelReason {
  return typeof value === "string" && (DESK_CANCEL_REASONS as readonly string[]).includes(value);
}

/** "Other" alone records nothing, so it needs a remark — the same rule Picking
 *  applies to its own "Other" (cancelRequiresNote). Routes 400; forms disable. */
export function deskCancelRequiresNote(reason: DeskCancelReason): boolean {
  return reason === "other";
}

/** {value,label} pairs for the forms, in DESK_CANCEL_REASONS order. */
export const DESK_CANCEL_REASON_OPTIONS: { value: DeskCancelReason; label: string }[] =
  DESK_CANCEL_REASONS.map((value) => ({ value, label: DESK_CANCEL_REASON_LABELS[value] }));

// Prefix ("Cancelled — ") and separator (" · ") read off Picking's builder, never
// retyped — a change to that builder moves this one with it.
const PROBE_BASE = buildCancelNote("other");
const NOTE_PREFIX = PROBE_BASE.slice(0, PROBE_BASE.length - CANCEL_REASON_LABELS.other.length);
const NOTE_SEPARATOR = buildCancelNote("other", "x").slice(PROBE_BASE.length, -1);

/** The note for order_status_logs: "Cancelled — {Label}" (+ " · {remark}"). */
export function buildDeskCancelNote(reason: DeskCancelReason, remark?: string | null): string {
  const trimmed = typeof remark === "string" ? remark.trim() : "";
  const base = `${NOTE_PREFIX}${DESK_CANCEL_REASON_LABELS[reason]}`;
  return trimmed.length > 0 ? `${base}${NOTE_SEPARATOR}${trimmed}` : base;
}

/** The remark cap — Picking's constant, so every cancel form agrees. */
export const DESK_CANCEL_NOTE_MAX = CANCEL_NOTE_MAX;
