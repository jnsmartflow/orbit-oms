// ─────────────────────────────────────────────────────────
// Dispatch decision engine — pure functions only.
// No prisma import, no I/O, no Date.now(). Every decision
// derives solely from the inputs passed in — deterministic
// and backfill-safe.
//
// RULE 1 (slot assignment) lives here for now. The file is
// named broadly so future dispatch layers (e.g. volume-based
// rules) can add sibling functions later.
//
// IST conversion reuses the existing helpers rather than a
// new offset: istMinutes() from lib/slots/slot-ruler.ts for
// time-of-day, and the toLocaleDateString("en-CA", {timeZone:
// "Asia/Kolkata"}) + Date.UTC(y, m-1, d) pattern already used
// in app/api/import/obd/route.ts for the IST calendar date.
//
// DUAL CLOCK — two candidate timestamps come in (emailDateTime
// = mail-received time, punchDateTime = OBD punch time). Before
// the window rule runs, the engine picks ONE "effectiveDateTime"
// to feed it: same IST calendar date → earlier of the two;
// different IST calendar date → later of the two. In practice
// punch always follows email, so same-day resolves to email time
// and different-day (carried-over order) resolves to punch time —
// but the earlier/later rule is implemented generically so bad
// data can never push a slot backwards into the past.
//
// CLOCK PICK          Email        Punch        Uses        Local slot
// same day            Mon 11:00    Mon 11:05    Mon 11:00   Mon 12:30
// different day       Sun 10:15    Mon 10:00    Mon 10:00   Mon 10:30
// different day       Sun 10:15    Mon 14:00    Mon 14:00   Mon 16:00
// different day       Sun 10:15    Mon 17:30    Mon 17:30   Tue 10:30
// different day (Upc) Sun 09:00    Mon 16:00    Mon 16:00   Mon 18:00
// punch null          Mon 11:00    —            Mon 11:00   Mon 12:30
// email null          —            Mon 14:00    Mon 14:00   Mon 16:00
//
// Window rule (applied to the chosen clock) is unchanged:
// Local  <=10:30 → 10:30 | <=12:30 → 12:30 | <=16:00 → 16:00 | else next-day 10:30
// Upc    <=17:00 → same-day 18:00 | else next-day 18:00
// ─────────────────────────────────────────────────────────

import { istMinutes } from "@/lib/slots/slot-ruler";

export interface DispatchSlotInput {
  smu: string | null;             // orders.smu
  dispatchStatus: string | null;  // orders.dispatchStatus
  deliveryType: string | null;    // resolved "Local" | "Upcountry" | other | null
  emailDateTime: Date | null;     // orders.orderDateTime (mail received time, post-enrichment)
  punchDateTime: Date | null;     // orders.obdEmailDate (despite the column name: OBD punch date+time)
}

export type DispatchSlotWindowTime = "10:30" | "12:30" | "16:00" | "18:00";

export type DispatchSlotClockUsed = "email" | "punch";

export type DispatchSlotResult =
  | {
      assigned: true;
      targetDate: Date; // date-only, IST calendar date
      windowTime: DispatchSlotWindowTime;
      ruleId: string;
      source: "auto";
      effectiveDateTime: Date;       // which clock actually decided the slot
      clockUsed: DispatchSlotClockUsed; // audit: which one won
    }
  | {
      assigned: false;
      reason:
        | "smu-not-deco-retail"
        | "status-not-dispatch"
        | "delivery-type-unhandled"
        | "no-order-datetime";
    };

/** IST calendar-date components (y/m/d) for a given Date, via the
 *  same toLocaleDateString("en-CA", {timeZone: "Asia/Kolkata"}) pattern
 *  already used in app/api/import/obd/route.ts. */
function istDateParts(date: Date): { y: number; m: number; d: number } {
  const [y, m, d] = date
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .split("-")
    .map(Number);
  return { y, m, d };
}

/** Date-only (midnight UTC) representation of an IST calendar date —
 *  mirrors the Date.UTC(y, m-1, d) construction used by the Support
 *  dispatch-target-date routes (CLAUDE_SUPPORT.md §4.10) to avoid
 *  IST/UTC day-shift. */
function dateOnlyUTC(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** Pick which of the two candidate clocks feeds the window rule.
 *  Same IST calendar date → earlier of the two. Different IST
 *  calendar date → later of the two. Either clock missing → the
 *  other one wins outright. Both missing → null (caller reports
 *  "no-order-datetime"). */
function pickEffectiveClock(
  emailDateTime: Date | null,
  punchDateTime: Date | null,
): { effectiveDateTime: Date; clockUsed: DispatchSlotClockUsed } | null {
  if (emailDateTime == null && punchDateTime == null) return null;
  if (emailDateTime == null) return { effectiveDateTime: punchDateTime!, clockUsed: "punch" };
  if (punchDateTime == null) return { effectiveDateTime: emailDateTime, clockUsed: "email" };

  const emailParts = istDateParts(emailDateTime);
  const punchParts = istDateParts(punchDateTime);
  const sameIstDate =
    emailParts.y === punchParts.y &&
    emailParts.m === punchParts.m &&
    emailParts.d === punchParts.d;

  const emailIsEarlierOrEqual = emailDateTime.getTime() <= punchDateTime.getTime();

  if (sameIstDate) {
    return emailIsEarlierOrEqual
      ? { effectiveDateTime: emailDateTime, clockUsed: "email" }
      : { effectiveDateTime: punchDateTime, clockUsed: "punch" };
  }

  // Different IST calendar date — use the later of the two.
  return emailIsEarlierOrEqual
    ? { effectiveDateTime: punchDateTime, clockUsed: "punch" }
    : { effectiveDateTime: emailDateTime, clockUsed: "email" };
}

/** RULE 1 — slot assignment. Any gate failure returns assigned:false
 *  with the matching reason; gates are evaluated in the fixed order
 *  below so the reported reason is deterministic. */
export function evaluateDispatchSlot(input: DispatchSlotInput): DispatchSlotResult {
  const { smu, dispatchStatus, deliveryType, emailDateTime, punchDateTime } = input;

  if (smu !== "Deco Retail") {
    return { assigned: false, reason: "smu-not-deco-retail" };
  }
  if (dispatchStatus?.toLowerCase() !== "dispatch") {
    return { assigned: false, reason: "status-not-dispatch" };
  }
  if (deliveryType !== "Local" && deliveryType !== "Upcountry") {
    return { assigned: false, reason: "delivery-type-unhandled" };
  }

  const clock = pickEffectiveClock(emailDateTime, punchDateTime);
  if (clock == null) {
    return { assigned: false, reason: "no-order-datetime" };
  }
  const { effectiveDateTime, clockUsed } = clock;

  const mins = istMinutes(effectiveDateTime);
  const { y, m, d } = istDateParts(effectiveDateTime);
  const today = dateOnlyUTC(y, m, d);
  const nextDay = dateOnlyUTC(y, m, d + 1);

  if (deliveryType === "Local") {
    if (mins <= 630) {
      return { assigned: true, targetDate: today, windowTime: "10:30", ruleId: "R1_LOCAL_1030", source: "auto", effectiveDateTime, clockUsed };
    }
    if (mins <= 750) {
      return { assigned: true, targetDate: today, windowTime: "12:30", ruleId: "R1_LOCAL_1230", source: "auto", effectiveDateTime, clockUsed };
    }
    if (mins <= 960) {
      return { assigned: true, targetDate: today, windowTime: "16:00", ruleId: "R1_LOCAL_1600", source: "auto", effectiveDateTime, clockUsed };
    }
    return { assigned: true, targetDate: nextDay, windowTime: "10:30", ruleId: "R1_LOCAL_NEXT_1030", source: "auto", effectiveDateTime, clockUsed };
  }

  // Upcountry — single 18:00 window, cutoff 17:00 (1020 minutes).
  if (mins <= 1020) {
    return { assigned: true, targetDate: today, windowTime: "18:00", ruleId: "R1_UPC_1800", source: "auto", effectiveDateTime, clockUsed };
  }
  return { assigned: true, targetDate: nextDay, windowTime: "18:00", ruleId: "R1_UPC_NEXT_1800", source: "auto", effectiveDateTime, clockUsed };
}
