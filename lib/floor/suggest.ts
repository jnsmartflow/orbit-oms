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
// (non-"Deco Retail" SMU, IGT/other delivery type, or no timestamp) OR the
// suggested window has already passed today (the stale case, design §11.3).
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
    smu: input.smu,
    dispatchStatus: "dispatch",
    deliveryType: input.deliveryType,
    emailDateTime: input.emailDateTime,
    punchDateTime: input.punchDateTime,
  });
  if (!r.assigned) return null;

  const targetIso = r.targetDate.toISOString().slice(0, 10);
  const todayIso = istDateOnly(input.now);

  // Stale: a today-dated suggestion whose window has already passed. Matches the
  // approved rule-tester (docs/mockups/floor-control/03-slot-rule.html): strict
  // greater-than, so a bill exactly at the window minute is not yet "passed".
  if (targetIso === todayIso && istMinutes(input.now) > windowMinutes(r.windowTime)) {
    return null;
  }

  return { windowTime: r.windowTime, targetDate: targetIso, ruleId: r.ruleId };
}
