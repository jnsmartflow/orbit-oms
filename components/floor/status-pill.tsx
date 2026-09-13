"use client";

// Floor Control — the FOUR locked status pills (design §7.6). Colour lives HERE
// and nowhere else on the floor: Waiting grey / With picker violet / Needs check
// amber / Done green. Each pill carries its elapsed time (design §7.7); the time
// string is computed by the table (it needs the shared clock) and passed in.
//
// Also exports the row→status mapping and count helper reused by the progress
// bar, slot bands and route rows so the four surfaces can never disagree.

import { Check } from "lucide-react";
import { DUP_SO_BADGE_CLASS } from "@/components/shared/duplicate-so-tag";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorStatus =
  | "waiting"
  | "withPicker"
  | "needsCheck"
  | "done"
  | "dispatched"
  // ── The tint room (2026-09-13) ────────────────────────────────────────────
  // A tint order passes through the tint room BEFORE picking, and until today
  // all three of its stages fell through every guard below and rendered as grey
  // "Waiting" — the same pill a bill wears while waiting for a picker. A picker
  // cannot touch a bill that is on the mixer, so the board was asserting work
  // was available that nobody could start. Fourth instance of the fall-through
  // class lib/workflow-stages.ts warns about, after pick_done, pick_checked and
  // dispatched.
  //
  // FOUR, NOT THREE, SINCE 2026-09-14. `tintAssigned` and `tinting` were one
  // value, so a bill sitting untouched in an operator's queue rendered the same
  // pill as one on the mixer. That is the same lie one level down: the board
  // claiming work is happening when it may not be.
  | "tintPending"
  | "tintAssigned"
  | "tinting"
  | "tintDone";

type StatusInput = Pick<FloorBoardRow, "isAssigned" | "isDone" | "isChecked"> &
  // Optional so the many callers that build a StatusInput by hand (the Hold and
  // Cancelled tabs, the trip counters) are untouched — undefined reads as false,
  // which is correct for every one of them: none can hold a shipped bill.
  Partial<Pick<FloorBoardRow, "isDispatched">> &
  // Optional for the same reason, and `undefined` reads as "not a tint bill",
  // which is right for every hand-built caller: the Hold and Cancelled tabs and
  // the trip counters all describe bills by their PICKING state and none of them
  // carries a tint phase. Only the board row does.
  Partial<Pick<FloorBoardRow, "tintPhase">>;

/**
 * The statuses that mean "ready for a picker, and nobody has it yet".
 *
 * 🔴 TWO MEMBERS, AND THE SECOND IS THE POINT. A tint bill whose shades are
 * finished sits at exactly the same rung as a plain waiting bill — on the floor,
 * pickable, untouched — it just wears a different pill so the operator can see
 * it came through the tint room. Any count or gate that means "waiting for a
 * picker" must ask this set, never `=== "waiting"`, or a tinted bill silently
 * stops being counted as available work the moment it is ready.
 */
const PICKABLE_WAITING: readonly FloorStatus[] = ["waiting", "tintDone"];

/**
 * The statuses that mean "the tint room still has it". NOT pickable by anyone.
 *
 * ⚠ `tintDone` IS DELIBERATELY NOT HERE. Its shades are finished; the tint room
 * is done with it. Folding it in would report a bill that is ready to pick as
 * stuck on the mixer.
 */
const IN_TINTING: readonly FloorStatus[] = ["tintPending", "tintAssigned", "tinting"];

/**
 * dispatched → Dispatched, pick_checked → Done, pick_done → Needs check,
 * pick_assigned → With picker, else (pending_picking) → Waiting.
 *
 * 🔴 THE `isDispatched` TEST IS FIRST, AND IT IS THE WHOLE POINT OF THIS CHANGE.
 * Until 2026-09-11 this union had four members and no `dispatched` arm, so a
 * shipped bill — `isAssigned`, `isDone` and (before today) `isChecked` all false
 * — fell through every guard and rendered as **WAITING**. A bill that had left
 * the depot showed on screen as not started. That is precisely the fall-through
 * bug class lib/workflow-stages.ts:271 warns about, and it has now bitten a
 * third time (after pick_done and pick_checked).
 *
 * It runs BEFORE `isChecked` because getFloorBoard sets `isChecked` true for a
 * dispatched bill too (it was checked on its way out) — so a checked-first order
 * would label every shipped bill "Done" and the new arm would be dead.
 *
 * ⚠ REACHABLE ONLY FROM HISTORY. The live board predicate does not admit rank
 * 100. If this pill ever appears on the live board, the live predicate has been
 * widened and that is the bug, not this function.
 */
export function rowStatus(row: StatusInput): FloorStatus {
  if (row.isDispatched) return "dispatched";
  if (row.isChecked) return "done";
  if (row.isDone) return "needsCheck";
  // ⚠ THE PICKING BOOLEANS ABOVE OUTRANK THE TINT PHASE, AND THE ORDER IS THE
  // RULE. A tint bill with a picker carries `tintPhase: "done"` AND
  // `isAssigned: true`; the floor's answer wins once somebody is holding the
  // bill, so "With picker" must be reachable for a tint order. Reading the phase
  // first would pin every tinted bill to "Tint done" for the rest of its life.
  //
  // What is left below this line is exactly "nobody has it yet", which is where
  // the tint room's three answers belong — including "Tint done", which is the
  // tinted twin of "Waiting" and sits on the same rung (see PICKABLE_WAITING).
  if (row.isAssigned) return "withPicker";
  if (row.tintPhase === "pending") return "tintPending";
  if (row.tintPhase === "assigned") return "tintAssigned";
  if (row.tintPhase === "tinting") return "tinting";
  if (row.tintPhase === "done") return "tintDone";
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
  // ⚠ `PICKABLE_WAITING`, NOT `=== "waiting"` (2026-09-13). A tint bill whose
  // shades are finished is on the picking board like any other and CAN be held
  // back; it just wears "Tint done" instead of "Waiting" now. Testing the
  // literal would have silently dropped every tinted bill out of the "N not
  // shown" count and off the Show strip the moment the pills landed — the count
  // would have been wrong in the safe-looking direction, which is the hardest
  // kind to notice.
  return PICKABLE_WAITING.includes(rowStatus(row)) && row.pickVisibleAt === null;
}

const META: Record<FloorStatus, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-[#f3f4f6] text-[#6b7280]" },
  withPicker: { label: "With picker", cls: "bg-tint-bg text-tint-700" },
  needsCheck: { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" },
  done: { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" },
  // ── Dispatched (2026-09-11) ────────────────────────────────────────────────
  // 🔴 DELIBERATELY NOT A SECOND GREEN. "Done" already owns green on this screen
  // and it means a DIFFERENT thing — the floor finished its work. Dispatched
  // means the goods have left the building, which is past finished: nothing on
  // any depot screen can act on it again. Two greens side by side would read as
  // two shades of the same state and the operator would have to learn which is
  // which.
  //
  // Slate, the same family "At desk" uses for its own out-of-play reading, and
  // DARKER than the waiting grey so it reads as a settled fact rather than an
  // absence. Not amber (that is "needs check", a call to action), not red (this
  // is the good outcome), not teal (reserved for the primary action,
  // CLAUDE_UI §1).
  dispatched: { label: "Dispatched", cls: "bg-[#e2e8f0] text-[#334155]" },
  // ── The three tint pills (2026-09-13) ──────────────────────────────────────
  //
  // 🔴 PINK, AND NOT VIOLET. Violet is Orbit's ACTION colour (CLAUDE_UI §1) and
  // it is already spent on this very row — "With picker" wears it. A violet tint
  // pill would read as a thing to click, and would collide with the one status
  // it most needs to be told apart from. Pink is unclaimed on every floor
  // surface and carries no action meaning anywhere in the app.
  //
  // ⚠ WEIGHT CARRIES THE PROGRESS, which is what makes three pills of one hue
  // readable at a glance instead of three shades to memorise:
  //   pale    → not started (the tint room has not begun)
  //   solid   → in hand (somebody is mixing it right now — the loudest state,
  //             and the only one that is actively blocking a truck)
  //   outline → finished (done, and quiet again, like every other outline on a
  //             finished thing)
  //
  // ⚠ A PLAIN ORDER NEVER WEARS PINK. `tintPhase` is null on a non-tint bill and
  // `rowStatus` falls through to grey "Waiting", byte-identical to before.
  //
  // ── FOUR STATES, ONE HUE, FOUR TREATMENTS (2026-09-14) ────────────────────
  // Empty → light → loud → ticked. The WEIGHT carries the progress, so the
  // reader learns one colour and one ramp instead of four pinks to tell apart.
  // SOLID IS THE ONLY STATE WHERE WORK IS ACTUALLY HAPPENING, which is the whole
  // reason `tintAssigned` was split out of it.
  tintPending: {
    // 🔴 "Waiting", THE SAME WORD THE GREY PILL USES, AND THAT IS DELIBERATE —
    // DO NOT "FIX" THE DUPLICATION. The word says the STATE and the colour says
    // WHICH ROOM: grey Waiting is waiting for a picker, pink Waiting is waiting
    // for a tint operator. Renaming this one to keep the labels unique would
    // make the reader learn two words for one state, and would lose the pairing
    // that makes the pink ramp legible beside the grey one.
    label: "Waiting",
    cls: "border border-[#f9a8d4] text-[#db2777] dark:border-[#9d174d] dark:text-[#f9a8d4]",
  },
  tintAssigned: {
    // ⚠ "With operator", MIRRORING "With picker" ONE COLUMN OVER — the same
    // sentence shape for the same fact, a named person is holding it.
    //
    // 🔴 IT IS ALSO THE HONEST WORD FOR A PAUSED JOB. Pause is written to the
    // assignment row and never to the order's stage (CLAUDE_TINT §5), so a
    // paused bill is indistinguishable from a running one at `tinting_in_
    // progress` — the board cannot know. "With operator" stays true either way;
    // it claims possession, not activity. Whether the machine is running is on
    // the detail panel, which reads the assignment row.
    label: "With operator",
    cls: "bg-[#fce7f3] text-[#be185d] dark:bg-[#3d1229] dark:text-[#f9a8d4]",
  },
  tinting: {
    // The one solid fill. Same value in both themes: a saturated pink under
    // white text reads identically on either ground, and dimming it for dark
    // mode would lose exactly the emphasis this state is carrying — it is the
    // only pink that means a machine is running and a truck may be waiting.
    label: "Tinting",
    cls: "bg-[#db2777] text-white dark:bg-[#db2777] dark:text-white",
  },
  tintDone: {
    // Deep fill plus a TICK. The tick is what separates this from "With
    // operator" at a glance — two filled pinks a step apart in depth are a weak
    // distinction on a dense row, and a glyph is not. Rendered by the pill body
    // below, keyed off the status, so no caller has to remember it.
    label: "Tint done",
    cls: "bg-[#fbcfe8] text-[#9d174d] dark:bg-[#5c1638] dark:text-[#fbcfe8]",
  },
};

/** The one status that carries a glyph. Kept beside META so the pill body has a
 *  single place to ask, rather than a literal in the render. */
const TICKED: readonly FloorStatus[] = ["tintDone"];

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
      {/* The tick on Tint done — see TICKED. `strokeWidth` 3 because at 10px a
          default-weight check reads as a smudge. */}
      {TICKED.includes(status) && !onRed && (
        <Check size={10} strokeWidth={3} className="mr-1 shrink-0" />
      )}
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
  /**
   * Shipped. ALWAYS 0 on a live board — the live predicate does not admit rank
   * 100 — and non-zero only on a history day.
   *
   * ⚠ IT IS ITS OWN BUCKET, NOT FOLDED INTO `done`. `countByStatus` keys off
   * `rowStatus`, so without this key a dispatched row would increment
   * `c["dispatched"]` on an object that has no such property: `undefined + 1` is
   * NaN, and every progress bar built on these counts would render empty. The
   * bucket is required for the counts to add up, exactly as `other` is on
   * TripBillCounts.
   */
  dispatched: number;
  /**
   * The tint room's three buckets (2026-09-13).
   *
   * ⚠ REQUIRED FOR THE COUNTS TO ADD UP, exactly as `dispatched` is.
   * `countByStatus` does `c[rowStatus(r)]++`, so a status with no key here
   * increments `undefined` and every progress bar built on these counts renders
   * NaN-wide. A key per status, always.
   *
   * ⚠ AND A SEGMENT PER KEY IN progress-bar.tsx, or the bar quietly renders
   * short — its own header says so and it has happened once already.
   */
  tintPending: number;
  tintAssigned: number;
  tinting: number;
  tintDone: number;
  total: number;
}

/**
 * Bills ready for a picker with nobody on them — grey Waiting PLUS pink Tint
 * done, which is the same rung wearing a different pill.
 *
 * 🔴 IT EXISTS SO THE HEADER CANNOT LIE THE OTHER WAY. Splitting the tint states
 * out of `waiting` was the point of the change; letting `tintDone` fall out with
 * them would have been the same defect mirrored — a bill sitting on the floor,
 * pickable and untouched, missing from the one number that counts exactly that.
 */
export function waitingForPickerCount(c: StatusCounts): number {
  // Summed FROM the set, not from a hand-written pair, so the set stays the one
  // definition and adding a member cannot leave this behind.
  return PICKABLE_WAITING.reduce((n, k) => n + c[k as keyof StatusCounts], 0);
}

/**
 * Bills the tint room still holds. Nobody can pick these, whatever else the
 * board says about them.
 *
 * 🔴 THE NUMBER THE HEADER WAS HIDING. "16 waiting" counted five bills that were
 * on the mixer, so it told the planner there was work available that no picker
 * could start. Same defect class as the "checked today" count fixed 2026-09-12:
 * a label asserting something it does not test.
 */
// ⚠ NO CALLER SINCE 2026-09-14, AND KEPT ANYWAY. Its reader was the header's
// "N in tinting" readout, which the TINTING TAB's own badge replaced. The fold
// itself — which statuses mean "the tint room still has it" — is a rule worth
// exactly one home, and the next surface to ask should find this rather than
// write `tintPending + tintAssigned + tinting` for itself and get it wrong when
// a fifth state appears.
export function inTintingCount(c: StatusCounts): number {
  return IN_TINTING.reduce((n, k) => n + c[k as keyof StatusCounts], 0);
}

/**
 * How many of these bills are FINISHED — checked plus shipped.
 *
 * 🔴 IT EXISTS SO "N of M done" CANNOT LIE ON A HISTORY DAY. Every summary line
 * read `counts.done` alone, which is the `pick_checked` bucket only. On a past
 * day where 28 of 40 bills had shipped, the route header said "12 of 40 done" —
 * the twelve that were checked and never dispatched. That is not a wording
 * problem: a shipped bill is the most finished a bill can be, and a line that
 * omits it reports a day's work as two thirds undone. Owner ruling 2026-09-11.
 *
 * ⚠ A DERIVED READ, NOT A WIDER BUCKET. `done` and `dispatched` stay separate in
 * StatusCounts and separate on the progress bar and the pill, because they ARE
 * different facts and the bar is meant to show which. Only the single "how much
 * of this is finished" number folds them, and it folds them HERE so the next
 * call site cannot forget — the same reason `rowStatus` and `isHeldBack` live in
 * this file rather than at their call sites.
 *
 * ⚠ ALWAYS EQUAL TO `counts.done` ON A LIVE BOARD. `floorLiveBaseWhere` does not
 * admit rank 100, so `dispatched` is 0 on every live row set and this returns
 * exactly what the old expression did. Verified by construction, not by hope:
 * the only predicate that admits the stage is FLOOR_HISTORY_STAGES.
 */
export function finishedCount(counts: StatusCounts): number {
  return counts.done + counts.dispatched;
}

export function countByStatus(rows: StatusInput[]): StatusCounts {
  const c: StatusCounts = {
    waiting: 0, withPicker: 0, needsCheck: 0, done: 0, dispatched: 0,
    tintPending: 0, tintAssigned: 0, tinting: 0, tintDone: 0, total: rows.length,
  };
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
