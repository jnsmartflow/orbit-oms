// ─────────────────────────────────────────────────────────
// Which clocks may the dispatch engine see?
//
//   hasClockTime(d)                     — does this timestamp carry a time of day?
//   resolveArrivalClocks(email, punch)  — the pair to hand evaluateDispatchSlot
//
// THE SINGLE OWNER of both questions. Import them; never write a second copy.
// Two consumers today — the import auto-slot call site
// (app/api/import/obd/route.ts) and the rail suggestion (lib/floor/suggest.ts)
// — and they MUST agree, or a bill would be slotted on one clock and hinted on
// another.
//
// WHY THIS EXISTS
// ---------------
// `orders.obdEmailDate` is documented as an OBD punch date+TIME
// (dispatch-engine.ts). For manual SAP uploads it is not: the 19-column SAP
// layout has NO "OBD Email Time" column, so the parser hardcodes
// `obdEmailTime: null` (lib/sap-parser/build-obd.ts), `mergeEmailDateTime`
// returns the date untouched (lib/import-upsert/helpers.ts), and the column
// lands at exactly 00:00:00.000 UTC — which renders as 05:30 IST.
//
// That fake 05:30 is earlier than every dispatch window AND earlier than the
// real order-email time on the same day, so the engine's pickEffectiveClock
// (same IST date -> take the EARLIER of the two) picks it every time and pins
// the bill to R1_LOCAL_1030. A bill emailed at 15:22 was landing in the 10:30
// batch. Audited 2026-08-03 over 9,521 rows: 5,517 such values.
//
// A date with no time is not a clock. Callers use this to pass `null` instead,
// which drops the engine to its single-clock path. If BOTH clocks end up null
// the engine declines with "no-order-datetime" and the bill reaches the
// operator with no slot — deliberately. A wrong slot is worse than no slot;
// there is no fallback, and none should be added.
//
// ⚠ THE TEST IS UTC MIDNIGHT, NOT IST MIDNIGHT — this distinction is the whole
// correctness of the helper. Two live rows sit at 18:30 UTC, which IS 00:00 IST,
// and they are GENUINE times: `mergeEmailDateTime("00:00")` computes
// `utcMin = 0 - 330` and correctly rolls back to the previous day at 18:30 UTC.
// An "is it midnight in IST" test would throw those away. Only 00:00:00.000 UTC
// means "no time was ever supplied".
//
// The tell was verified to have ZERO false positives (audit 2026-08-03,
// scripts/_time-tell.ts): of 9,521 orders, no auto-import row is at UTC
// midnight, and no UTC-midnight row has a time recorded on its source summary.
// ─────────────────────────────────────────────────────────

/**
 * True when `d` carries a usable time of day.
 *
 * False for null/undefined, for an invalid Date, and for exactly
 * 00:00:00.000 **UTC** — the shape a date-only value takes when no time column
 * existed to merge in.
 */
export function hasClockTime(d: Date | null | undefined): boolean {
  if (d == null) return false;
  // An unparseable date is not a clock either — never hand NaN to the engine,
  // where istMinutes() would silently propagate it into the window compare.
  if (Number.isNaN(d.getTime())) return false;
  return !(
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/** IST calendar day as "YYYY-MM-DD". Same toLocaleDateString("en-CA", …)
 *  pattern the engine's istDateParts uses, so the two can never disagree about
 *  which day a timestamp falls on. Zero-padded, so lexical order IS calendar
 *  order. Never Date.parse on an offset-less string (CORE §3) — that would be
 *  read in the host timezone and land 5.5 h out on a depot browser vs Vercel. */
function istDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** The pair of clocks to hand `evaluateDispatchSlot`. */
export interface ResolvedClocks {
  emailDateTime: Date | null;
  punchDateTime: Date | null;
}

/** Does this value carry a usable CALENDAR DAY, even if it carries no time?
 *  A date-only value does; null and an invalid Date do not. */
function hasUsableDay(d: Date | null | undefined): d is Date {
  return d != null && !Number.isNaN(d.getTime());
}

/**
 * Decide WHICH arrival clocks the engine may see. One owner, both call sites —
 * the import auto-slot path and the rail suggestion — so they cannot drift.
 *
 * SYMMETRIC: both clocks are validated. Either can be date-only.
 * ------------------------------------------------------------
 * `orders.obdEmailDate` is date-only for manual SAP (no time column). So is
 * `orders.orderDateTime` on a manual-SAP order that was never mail-matched:
 * `mergeEmailDateTime(obdEmailDate, null)` returns the date untouched, so the
 * "email" clock is midnight UTC too. Validating only the punch left two holes:
 *   (i)  lib/floor/suggest.ts runs on EVERY rail bill, not just mail-matched
 *        ones, so such a bill rendered a confident one-click "Today 10:30"
 *        button built on a fake 05:30;
 *   (ii) with a date-only email and a REAL punch, pickEffectiveClock's same-day
 *        "earlier wins" rule still picked the fake 05:30 over the real time.
 *
 * A date-only value is not a clock, but it IS a day, and the day is
 * trustworthy. That asymmetry drives the whole ladder:
 *
 *   both real                  -> pass BOTH (engine merge, unchanged)
 *   neither real               -> pass NEITHER
 *   email real, punch not      -> punch's day LATER than email's -> pass NEITHER
 *                                 otherwise                      -> EMAIL only
 *   punch real, email not      -> email's day LATER than punch's -> pass NEITHER
 *                                 otherwise                      -> PUNCH only
 *
 * The two middle rules are the same rule seen from each side: if the clock we
 * DON'T have sits on a later day than the one we do, the bill belongs to that
 * later day and we have no time for it — anchoring to the older clock would
 * schedule into the past. When the dayless side is equal or earlier, the clock
 * we have is already the later of the two, which is exactly what the engine's
 * cross-day rule would have chosen anyway.
 *
 * "Pass neither" makes the engine return `no-order-datetime`, and the bill
 * reaches the operator with NO slot. That is the intended outcome, not a gap: a
 * slot in the past is worse than no slot. Do not add a fallback.
 *
 * (Named for ARRIVAL clocks, not "punch" — it now owns both sides. Renamed from
 * resolvePunchClocks in the commit that made it symmetric.)
 */
export function resolveArrivalClocks(
  emailDateTime: Date | null | undefined,
  punchDateTime: Date | null | undefined,
): ResolvedClocks {
  const email = emailDateTime ?? null;
  const punch = punchDateTime ?? null;
  const emailReal = hasClockTime(email);
  const punchReal = hasClockTime(punch);

  // The engine's normal input — hand both over untouched.
  if (emailReal && punchReal) {
    return { emailDateTime: email, punchDateTime: punch };
  }

  // Neither side is a clock: date-only, absent or invalid on both. Nothing to
  // anchor to, whatever days they may name.
  if (!emailReal && !punchReal) {
    return { emailDateTime: null, punchDateTime: null };
  }

  // Exactly one real clock. Lexical compare of zero-padded YYYY-MM-DD is a
  // calendar compare; a side with no usable day raises no cross-day question.
  if (emailReal) {
    if (hasUsableDay(punch) && istDay(punch) > istDay(email!)) {
      return { emailDateTime: null, punchDateTime: null };
    }
    return { emailDateTime: email, punchDateTime: null };
  }

  if (hasUsableDay(email) && istDay(email) > istDay(punch!)) {
    return { emailDateTime: null, punchDateTime: null };
  }
  return { emailDateTime: null, punchDateTime: punch };
}
