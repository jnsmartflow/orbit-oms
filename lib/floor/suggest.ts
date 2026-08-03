// Floor Control — render-time slot suggestion for the left-rail Release button.
//
// Reuses the LIVE dispatch engine (lib/dispatch/dispatch-engine.ts, Sunday-
// fixed in Step 0) — it never re-implements the rule, so the suggestion and the
// 80% auto-enrich path can never disagree. dispatchStatus is forced to
// "dispatch" because the suggestion answers "if I release this now, which slot?"
// — a rail bill's own dispatchStatus is null/undecided, which is precisely WHY
// it sits on the rail.
//
// Returns null → the UI shows grey "Set slot" — when the engine declines
// (IGT / other / missing delivery type, or no timestamp at all) OR the batch it
// would put the bill in has already CLOSED (design §11.3).
//
// SMU is deliberately NOT a gate here — see the literal at the call below.
//
// PURE: the clock is passed in as `now`; this file never calls Date.now().

import { evaluateDispatchSlot } from "@/lib/dispatch/dispatch-engine";
import type { SlotSuggestion } from "./types";

const MS_PER_MIN = 60 * 1000;

// IST is UTC+5:30. Used to turn an IST wall-clock window time into a real UTC
// instant — same 5.5 h basis as lib/floor/queries.ts's IST_OFFSET_MS.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * How long a dispatch batch stays OPEN past its own window time. Inside this
 * hour the suggestion still shows; once the batch closes, no suggestion — the
 * operator picks manually. There is deliberately NO roll-forward to a later
 * window: which batch a late bill should join is exactly the judgement the
 * operator is standing at the rail to make.
 *
 * WHY 60 MINUTES — two independent reasons, both load-bearing:
 *
 * (a) IMPORT LAG MAKES NEAR-CUTOFF BILLS ARRIVE PRE-EXPIRED. A bill is punched
 *     in SAP and only reaches us on the next import — measured at ~15-20 min
 *     (OBD 9108650059: punched 12:22, imported 12:39). The engine anchors on the
 *     PUNCH, so that bill is slotted to the 12:30 window but does not exist in
 *     our data until 12:39 — already past its own cutoff. With no grace period
 *     it could never show a suggestion at all. That is not an edge case: it is
 *     the normal fate of every bill punched in the minutes before a window.
 *
 * (b) IT CAN NEVER OVERLAP THE NEXT WINDOW. The smallest gap between consecutive
 *     windows is 10:30 -> 12:30 = 120 minutes (then 12:30 -> 16:00 = 210, and
 *     16:00 -> next working day 10:30 is far larger; Upcountry has a single
 *     18:00 window, so no gap to cross). 60 < 120, so a batch's grace always
 *     expires strictly before the next window opens, and a suggestion can never
 *     be shown for a batch the following window has already overtaken.
 *     Raising this past 120 breaks that property — do not.
 */
export const SUGGESTION_GRACE_MINUTES = 60;

export interface SuggestInput {
  smu: string | null;
  deliveryType: string | null;
  emailDateTime: Date | null; // orders.orderDateTime
  punchDateTime: Date | null; // orders.obdEmailDate
  now: Date;                  // clock — an argument, never Date.now() here
  // TINT ONLY — whole-order tint completion (tint_assignments.completedAt).
  // When supplied it REPLACES the two arrival clocks rather than joining them;
  // see the anchor block in suggestSlot for why that distinction matters.
  // Omitted / null → the ordinary arrival-anchored behaviour, unchanged.
  completionDateTime?: Date | null;
}

function windowMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function suggestSlot(input: SuggestInput): SlotSuggestion | null {
  // ── WHICH CLOCK ANCHORS THE SUGGESTION ─────────────────────────────────────
  //
  // Normally the two arrival clocks go in and the engine's pickEffectiveClock
  // merges them (same IST day → earlier, different day → later). For a COMPLETED
  // full tint OBD that merge is wrong input, not a wrong rule: arrival says when
  // the paper landed, and the only moment that bears on which batch the bill can
  // physically make is when the shades were finished.
  //
  // So a completion anchor REPLACES both arrival clocks outright — passed as
  // emailDateTime with punchDateTime null, which takes the engine's existing
  // single-clock path (pickEffectiveClock returns the non-null one immediately).
  // No dual-clock merge to reason about, and NO engine change.
  //
  // Feeding completion ALONGSIDE the punch would silently invoke that merge and
  // could hand back the punch instead on a different-IST-day bill — exactly the
  // arrival anchoring this exists to avoid. Replace, never add.
  const anchoredOnCompletion = input.completionDateTime != null;
  const emailDateTime = anchoredOnCompletion ? input.completionDateTime! : input.emailDateTime;
  const punchDateTime = anchoredOnCompletion ? null : input.punchDateTime;

  const r = evaluateDispatchSlot({
    // SMU gate NEUTRALISED with a literal — the same trick as dispatchStatus
    // below, and for the same reason: the engine's gates answer the AUTO-slot
    // question ("may I slot this without a human?"), where "Deco Retail only" is
    // deliberately narrow and correct. The rail hint answers a different one —
    // "if I release this now, which slot?" — and the operator asks that of every
    // SMU sitting on his rail. Only the WINDOW RULE is being reused; the scope
    // gate is not part of what we want.
    //
    // input.smu stays on SuggestInput on purpose (callers keep passing it): it
    // is input for the "why this slot" copy in a later phase, not a gate.
    smu: "Deco Retail",
    dispatchStatus: "dispatch",
    deliveryType: input.deliveryType,
    emailDateTime,
    punchDateTime,
  });
  if (!r.assigned) return null;

  const targetIso = r.targetDate.toISOString().slice(0, 10);

  // ── CLOSED-BATCH TEST — the one and only staleness rule ────────────────────
  //
  // This REPLACES the two arms that used to live here (a past-date string
  // compare, then a same-day minutes-since-IST-midnight compare). Both were
  // narrow views of one question, and the minutes form was the original 23-Jul
  // bug: minutes-since-midnight can only reason WITHIN a day, so a suggestion
  // dated in the past slipped past it entirely and rendered "Release to Wed
  // 16:00" on a Thursday. Comparing real MOMENTS collapses past-dated and
  // today-elapsed into the same case, and leaves nothing for a date arm to catch.
  //
  // A batch is open from its window time until grace minutes after it. Note the
  // batch may also be in the FUTURE (a 17:00 Local bill slots to tomorrow 10:30)
  // — that is open too, and correctly so: only the closing edge is tested.
  //
  // HOW THE MOMENT IS BUILT (CORE §3 landmine — read before touching):
  //   r.targetDate is a date-only UTC Date, Date.UTC(y, m-1, d), for the IST
  //   calendar date the engine picked — so its epoch value IS that day's UTC
  //   midnight. Adding the window's minutes gives that wall-clock time read as
  //   UTC; subtracting the 5:30 IST offset converts it into the true UTC instant
  //   of that IST wall time. Then add the grace.
  //     e.g. 2026-08-03 + 12:30 = 2026-08-03T12:30Z, -5:30 = 2026-08-03T07:00Z
  //          (which IS IST 12:30), +60 min = 2026-08-03T08:00Z (IST 13:30). ✓
  //
  //   NEVER Date.parse("2026-08-03T12:30:00"). An offset-less string is read in
  //   the HOST timezone, so it would land 5.5 h out on a depot browser (IST)
  //   versus a Vercel lambda (UTC), and the two would disagree about which
  //   batches are open. Everything below is epoch arithmetic on absolute
  //   instants — no string parsing, no host timezone, anywhere.
  const batchClosesAtMs =
    r.targetDate.getTime() +
    windowMinutes(r.windowTime) * MS_PER_MIN -
    IST_OFFSET_MS +
    SUGGESTION_GRACE_MINUTES * MS_PER_MIN;

  // Strict >, so a bill landing exactly on the closing minute is still open —
  // the same boundary convention the old window-minute arm used.
  if (input.now.getTime() > batchClosesAtMs) return null;

  return { windowTime: r.windowTime, targetDate: targetIso, ruleId: r.ruleId };
}
