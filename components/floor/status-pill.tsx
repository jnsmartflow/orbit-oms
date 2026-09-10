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

/**
 * Is this bill actually ready to go on a van?
 *
 * 🔴 BOTH TERMS ARE REQUIRED, AND THE SECOND ONE IS THE WHOLE POINT. The
 * depot's flow is: a picker picks it, the floor CHECKS it, billing raises the
 * INVOICE, and only then can it be loaded. `isChecked` alone would call a bill
 * ready while billing has not raised its invoice yet — and a bill with no
 * invoice number cannot legally leave the depot, so it would be a chip that
 * lied at exactly the moment a planner was deciding what to load.
 *
 * The invoice term looks redundant until you know that ordering, which is why
 * it is written down here rather than left as an obvious-looking `&&`. On
 * 2026-08-31 the invoice column's own live check found 65 of 70 checked bills
 * carrying an invoice and 0 of the 4 still-open ones — so the two states really
 * do come apart, and the gap is the bills that are done but not yet billed.
 *
 * ⚠ A BLANK STRING IS NOT AN INVOICE. `invoiceNo` is nullable and the importer
 * fills it only when SAP has stamped one, but a trimmed test costs nothing and
 * an empty string here would read as ready.
 *
 * ⚠ SAYS NOTHING ABOUT DATES. A bill promised for Saturday can be ready to load
 * today; that is a different question and the Due column answers it. Filtering
 * to Ready must not therefore drop the upcoming half of a list.
 */
export function isReadyToLoad(
  row: Pick<FloorBoardRow, "isChecked" | "invoiceNo">,
): boolean {
  return row.isChecked && typeof row.invoiceNo === "string" && row.invoiceNo.trim() !== "";
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

/**
 * THE one litres formatter for this screen (2026-09-10).
 *
 * 🔴 IT EXISTS BECAUSE A HEADER READ "4729.400000000001 L". Litres are stored as
 * a Float (`import_obd_query_summary.totalVolume`), and summing floats leaks
 * binary representation error into the display the moment a total is anything
 * but a round number — 0.1 + 0.2 is the textbook case and a pack list is full of
 * .4s and .9s. Nothing is wrong with the DATA; the sum is correct to within a
 * rounding error nobody can act on. It is the rendering that was wrong.
 *
 * ⚠ DISPLAY ONLY. This rounds nothing that is stored and nothing that is sent to
 * a route. Every caller passes a number it has already computed and uses the
 * string for text — do not feed a rounded value back into arithmetic.
 *
 * ONE decimal, and trailing `.0` dropped. A depot bill is quoted in whole litres
 * or to a tenth (0.9L, 3.6L, 18.5L packs), so a tenth is the finest distinction
 * that means anything and two decimals would be noise. `toLocaleString("en-US")`
 * keeps the thousands separator the screen already uses.
 *
 * 🔴 EVERY SURFACE THAT PRINTS LITRES MUST USE THIS. The band header and the
 * pool header sum different populations of the same bills; if one rounded and
 * the other did not, the two could disagree by a decimal on the same screen and
 * the operator would have no way to tell which was lying.
 */
export function formatLitres(litres: number): string {
  return Number(litres.toFixed(1)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

// ── Weight ───────────────────────────────────────────────────────────────────
// The kilogram pair, deliberately beside the litres pair. ONE OWNER PER
// BEHAVIOUR: this file already owns `formatLitres`/`sumLitres` for the same
// reason — a row, a stop header, a trip header and a selection bar all print the
// same totals and must not round them differently. A second formatting module
// would be a second answer.

/**
 * 🔴 ZERO IS NOT A WEIGHT — IT IS A MISSING ONE, AND THIS RETURNS null FOR IT.
 *
 * The importer writes `totalWeight: summary?.grossWeight ?? 0` at four sites in
 * app/api/import/obd/route.ts (:600, :611, :1339, :3292), so a bill whose SAP
 * gross weight never arrived is stored as 0 and is indistinguishable from a bill
 * that genuinely weighs nothing. 81 live orders sit at 0 (measured 2026-09-10,
 * code-discovery-2026-09-10-dates-weight-orphans.md §B4).
 *
 * A printed "0" in a KG column is a lie with consequences: a planner loading a
 * van against `vehicle_master.capacityKg` would under-count the load by however
 * much that bill actually weighs. null here, an em dash at the cell, and the
 * number is visibly absent instead of quietly wrong.
 *
 * ⚠ null IS THE ONLY HONEST RETURN, so callers must handle it. It is not a
 * convenience for empty rows — every caller has to decide what "unknown" looks
 * like on its own surface, and a total has to decide whether to say so.
 *
 * One decimal with the trailing .0 dropped, exactly like formatLitres: SAP
 * gross weights carry three decimals (lib/picking/group-lines.ts:48) and a
 * tenth of a kilo is already finer than anything the floor acts on.
 */
export function formatWeightKg(kg: number | null | undefined): string | null {
  if (kg === null || kg === undefined) return null;
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Number(kg.toFixed(1)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * Total the weight of a set of rows, and SAY HOW MANY IT COULD NOT COUNT.
 *
 * 🔴 THE SECOND FIELD IS THE POINT. `sumLitres` can return a bare number because
 * a null litres value is genuinely 0 for a total. Weight cannot: an unknown
 * weight counted as zero makes the total silently too small, and the operator
 * has no way to see that it happened. So this returns the pair and the caller
 * renders the caveat — the bottom bar prints "67+ kg" with the count on its
 * title when `unknown` is not zero.
 *
 * `kg` is the sum of the weights that ARE known. It is a lower bound, never a
 * guess: nothing here estimates a missing weight from litres, article counts or
 * anything else.
 */
export function sumWeightKg(
  rows: Array<Pick<FloorBoardRow, "weightKg">>,
): { kg: number; unknown: number } {
  let kg = 0;
  let unknown = 0;
  for (const r of rows) {
    const w = r.weightKg;
    if (w === null || w === undefined || !Number.isFinite(w) || w <= 0) unknown++;
    else kg += w;
  }
  return { kg, unknown };
}
