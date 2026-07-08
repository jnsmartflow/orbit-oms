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
// Worked examples (RULE 1 test cases):
//
//   Local  09:15 → today 10:30      Local 10:30 → today 10:30
//   Local  10:31 → today 12:30      Local 12:30 → today 12:30
//   Local  13:00 → today 16:00      Local 16:00 → today 16:00
//   Local  16:01 → next day 10:30   Local 20:00 → next day 10:30
//   Upc    11:00 → today 18:00      Upc   17:00 → today 18:00
//   Upc    17:01 → next day 18:00
// ─────────────────────────────────────────────────────────

import { istMinutes } from "@/lib/slots/slot-ruler";

export interface DispatchSlotInput {
  smu: string | null;            // orders.smu
  dispatchStatus: string | null; // orders.dispatchStatus
  deliveryType: string | null;   // resolved "Local" | "Upcountry" | other | null
  orderDateTime: Date | null;    // orders.orderDateTime (timestamptz / UTC)
}

export type DispatchSlotWindowTime = "10:30" | "12:30" | "16:00" | "18:00";

export type DispatchSlotResult =
  | {
      assigned: true;
      targetDate: Date; // date-only, IST calendar date
      windowTime: DispatchSlotWindowTime;
      ruleId: string;
      source: "auto";
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

/** RULE 1 — slot assignment. Any gate failure returns assigned:false
 *  with the matching reason; gates are evaluated in the fixed order
 *  below so the reported reason is deterministic. */
export function evaluateDispatchSlot(input: DispatchSlotInput): DispatchSlotResult {
  const { smu, dispatchStatus, deliveryType, orderDateTime } = input;

  if (smu !== "Deco Retail") {
    return { assigned: false, reason: "smu-not-deco-retail" };
  }
  if (dispatchStatus?.toLowerCase() !== "dispatch") {
    return { assigned: false, reason: "status-not-dispatch" };
  }
  if (deliveryType !== "Local" && deliveryType !== "Upcountry") {
    return { assigned: false, reason: "delivery-type-unhandled" };
  }
  if (orderDateTime == null) {
    return { assigned: false, reason: "no-order-datetime" };
  }

  const mins = istMinutes(orderDateTime);
  const { y, m, d } = istDateParts(orderDateTime);
  const today = dateOnlyUTC(y, m, d);
  const nextDay = dateOnlyUTC(y, m, d + 1);

  if (deliveryType === "Local") {
    if (mins <= 630) {
      return { assigned: true, targetDate: today, windowTime: "10:30", ruleId: "R1_LOCAL_1030", source: "auto" };
    }
    if (mins <= 750) {
      return { assigned: true, targetDate: today, windowTime: "12:30", ruleId: "R1_LOCAL_1230", source: "auto" };
    }
    if (mins <= 960) {
      return { assigned: true, targetDate: today, windowTime: "16:00", ruleId: "R1_LOCAL_1600", source: "auto" };
    }
    return { assigned: true, targetDate: nextDay, windowTime: "10:30", ruleId: "R1_LOCAL_NEXT_1030", source: "auto" };
  }

  // Upcountry — single 18:00 window, cutoff 17:00 (1020 minutes).
  if (mins <= 1020) {
    return { assigned: true, targetDate: today, windowTime: "18:00", ruleId: "R1_UPC_1800", source: "auto" };
  }
  return { assigned: true, targetDate: nextDay, windowTime: "18:00", ruleId: "R1_UPC_NEXT_1800", source: "auto" };
}
