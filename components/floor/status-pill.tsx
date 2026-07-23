"use client";

// Floor Control — the FOUR locked status pills (design §7.6). Colour lives HERE
// and nowhere else on the floor: Waiting grey / With picker violet / Needs check
// amber / Done green. Each pill carries its elapsed time (design §7.7); the time
// string is computed by the table (it needs the shared clock) and passed in.
//
// Also exports the row→status mapping and count helper reused by the progress
// bar, slot bands and route rows so the four surfaces can never disagree.

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

const META: Record<FloorStatus, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-[#f3f4f6] text-[#6b7280]" },
  withPicker: { label: "With picker", cls: "bg-[#ede9fe] text-[#6d28d9]" },
  needsCheck: { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" },
  done: { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" },
};

// Radius 4px (design §7.6 — a pill, not a capsule). Time rides inside after a
// faded dot; two-char units keep the pill from growing the column (§7.7).
export function StatusPill({ status, time }: { status: FloorStatus; time?: string | null }) {
  const m = META[status];
  return (
    <span className={`inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold ${m.cls}`}>
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
