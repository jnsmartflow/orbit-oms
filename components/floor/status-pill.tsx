"use client";

// Floor Control — the FOUR locked status pills (design §7.6). Colour lives HERE
// and nowhere else on the floor: Waiting grey / With picker violet / Needs check
// amber / Done green. Each pill carries its elapsed time (design §7.7); the time
// string is computed by the table (it needs the shared clock) and passed in.
//
// Also exports the row→status mapping and count helper reused by the progress
// bar, slot bands and route rows so the four surfaces can never disagree.

import { DUP_SO_BADGE_CLASS } from "@/components/shared/duplicate-so-tag";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorStatus = "waiting" | "withPicker" | "needsCheck" | "done";

type StatusInput = Pick<FloorBoardRow, "isAssigned" | "isDone" | "isChecked">;

// pick_checked → Done, pick_done → Needs check, pick_assigned → With picker,
// else (pending_picking) → Waiting. Order matters: checked wins over done wins
// over assigned (a row is only ever at one stage, but the guard is explicit).
export function rowStatus(row: StatusInput): FloorStatus {
  if (row.isChecked) return "done";
  if (row.isDone) return "needsCheck";
  if (row.isAssigned) return "withPicker";
  return "waiting";
}

/**
 * Is this bill still at the desk — waiting, and not yet handed to the floor?
 *
 * 🔴 THE ONE OWNER OF THIS RULE. The pill, the header's "N not shown" count and
 * the Show strip all ask this function; none of them re-derives it. Two halves,
 * and BOTH are load-bearing:
 *   - `rowStatus(row) === "waiting"` — only a waiting bill can be held back. An
 *     assigned, picked or checked bill is with a picker whatever its stamp says,
 *     and `buildPickingWhere` never gates those stages (the locked owner rule
 *     that /api/floor/pick-visible also enforces server-side).
 *   - `pickVisibleAt === null` — nobody has handed it over.
 *
 * ⚠ SAYS NOTHING ABOUT THE GATE. A held-back bill with the gate OFF is on the
 * picking board like any other, because the filter is not running. Every caller
 * pairs this with the gate state; this function answers only "is it stamped".
 */
export function isHeldBack(
  row: StatusInput & Pick<FloorBoardRow, "pickVisibleAt">,
): boolean {
  return rowStatus(row) === "waiting" && row.pickVisibleAt === null;
}

const META: Record<FloorStatus, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-[#f3f4f6] text-[#6b7280]" },
  withPicker: { label: "With picker", cls: "bg-tint-bg text-tint-700" },
  needsCheck: { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" },
  done: { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" },
};

// The HELD-BACK reading of `waiting` (2026-09-09). A waiting bill the operator
// has not yet handed to the floor: still at the desk, invisible to the picking
// board while the visibility gate is on.
//
// ⚠ A PROP ON THE PILL, DELIBERATELY NOT A FIFTH `FloorStatus`. `rowStatus()`
// above is the whole screen's status vocabulary — the slot bands, the route
// rows, the By-picker cards and the progress bar all count through it — and a
// held-back bill IS waiting on every one of those. Widening the union would
// have split those counts and made "waiting" mean something different on four
// surfaces, to change a label on one. The pill is the only place the
// distinction is worth drawing, so the distinction lives on the pill.
//
// SLATE, and neither red nor amber: a bill at the desk is a normal step in the
// operator's own flow, not a fault and not a delay. Not teal either — that is
// reserved for the primary action (CLAUDE_UI §1). Distinct enough from the
// waiting grey to read at a glance, quiet enough not to shout.
const HELD_BACK_META = { label: "At desk", cls: "bg-[#e2e8f0] text-[#475569]" };

// Radius 4px (design §7.6 — a pill, not a capsule). Time rides inside after a
// faded dot; two-char units keep the pill from growing the column (§7.7).
// ⚠ `onRed` — on a duplicate-SO row (#dc2626 fill) all four pale washes above
// are unreadable, so every status flips to the ONE shared white pill with
// #b91c1c text. The LABEL still carries the status, which is what the column
// is for; only the colour coding is spent — an acceptable trade, because on
// that row the red outranks the status. Optional + defaulted, so every
// non-duplicate row is byte-identical.
export function StatusPill({
  status,
  time,
  onRed = false,
  heldBack = false,
}: {
  status: FloorStatus;
  time?: string | null;
  onRed?: boolean;
  /**
   * Render the "At desk" reading instead of "Waiting" (2026-09-09).
   *
   * ⚠ IGNORED unless `status` is "waiting". Only a waiting bill can be held
   * back — an assigned or picked one is with a picker whatever its stamp says,
   * and the visibility gate never filters those stages. Guarding here rather
   * than trusting every call site means a caller that passes the flag too
   * widely gets the right pill anyway.
   *
   * Defaulted, so every pre-existing call site is byte-identical.
   */
  heldBack?: boolean;
}) {
  const m = heldBack && status === "waiting" ? HELD_BACK_META : META[status];
  return (
    <span
      className={`inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold ${
        onRed ? DUP_SO_BADGE_CLASS : m.cls
      }`}
    >
      {m.label}
      {time ? (
        <>
          <span className="mx-1 font-normal opacity-40">·</span>
          <span className="text-[9.5px] font-semibold tabular-nums opacity-70">{time}</span>
        </>
      ) : null}
    </span>
  );
}

export interface StatusCounts {
  waiting: number;
  withPicker: number;
  needsCheck: number;
  done: number;
  total: number;
}

export function countByStatus(rows: StatusInput[]): StatusCounts {
  const c: StatusCounts = { waiting: 0, withPicker: 0, needsCheck: 0, done: 0, total: rows.length };
  for (const r of rows) c[rowStatus(r)]++;
  return c;
}

export function sumLitres(rows: Array<Pick<FloorBoardRow, "volumeLitres">>): number {
  // Gift lines are OUT OF SCOPE this step — no gift-excluded totals, plain sum.
  return rows.reduce((s, r) => s + (r.volumeLitres ?? 0), 0);
}
