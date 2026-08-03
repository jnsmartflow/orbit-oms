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
// (IGT / other / missing delivery type, or no timestamp at all) OR the
// suggestion is already in the past (the stale cases, design §11.3).
//
// SMU is deliberately NOT a gate here — see the literal at the call below.
//
// PURE: the clock is passed in as `now`; this file never calls Date.now().

import { evaluateDispatchSlot } from "@/lib/dispatch/dispatch-engine";
import { istMinutes } from "@/lib/slots/slot-ruler";
import type { SlotSuggestion } from "./types";

export interface SuggestInput {
  smu: string | null;
  deliveryType: string | null;
  emailDateTime: Date | null; // orders.orderDateTime
  punchDateTime: Date | null; // orders.obdEmailDate
  now: Date;                  // clock — an argument, never Date.now() here
}

function windowMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function istDateOnly(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function suggestSlot(input: SuggestInput): SlotSuggestion | null {
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
    emailDateTime: input.emailDateTime,
    punchDateTime: input.punchDateTime,
  });
  if (!r.assigned) return null;

  const targetIso = r.targetDate.toISOString().slice(0, 10);
  const todayIso = istDateOnly(input.now);

  // STALE ARM 1 — the suggestion lands on an EARLIER IST day than today.
  //
  // The engine is anchored to the BILL's own clock (email/punch), never to wall
  // time, so a bill that has sat undecided on the rail since Wednesday still
  // evaluates to Wednesday's window — and on Thursday that rendered as "Release
  // to Wed 16:00". That is the 23-Jul bug, and it is why this whole feature was
  // switched off; the old guard below could never catch it, because it is gated
  // on targetIso === todayIso and short-circuits on a past date.
  //
  // String compare is exact: both sides are zero-padded YYYY-MM-DD, so lexical
  // order IS calendar order. targetIso comes off a UTC-midnight date-only Date
  // (the engine's Date.UTC construction), so .toISOString() cannot day-shift it.
  //
  // DECLINE, never re-anchor. Rolling a stale bill forward to today would make
  // the suggestion a function of when the page was rendered rather than of the
  // bill — inventing precisely the decision the operator is at the rail to make.
  if (targetIso < todayIso) return null;

  // STALE ARM 2 — a TODAY-dated suggestion whose window has already passed.
  // Matches the approved rule-tester (docs/mockups/floor-control/03-slot-rule.html):
  // strict greater-than, so a bill exactly at the window minute is not yet "passed".
  if (targetIso === todayIso && istMinutes(input.now) > windowMinutes(r.windowTime)) {
    return null;
  }

  return { windowTime: r.windowTime, targetDate: targetIso, ruleId: r.ruleId };
}
