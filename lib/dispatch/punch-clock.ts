// ─────────────────────────────────────────────────────────
// Which clocks may the dispatch engine see?
//
//   hasClockTime(d)                    — does this timestamp carry a time of day?
//   resolvePunchClocks(email, punch)   — the pair to hand evaluateDispatchSlot
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

/**
 * Decide WHICH clocks the engine may see. One owner, both call sites — the
 * import auto-slot path and the rail suggestion — so they cannot drift.
 *
 * WHY THIS IS MORE THAN `hasClockTime` ALONE
 * ------------------------------------------
 * Dropping a time-less punch (03b6dd19) also dropped the dual clock's CROSS-DAY
 * protection. pickEffectiveClock uses the LATER clock when the two fall on
 * different IST days, so a bill emailed 22 Jul and punched 25 Jul was correctly
 * anchored to 25 Jul. With the punch simply removed it fell back to the 22 Jul
 * email and got scheduled into a date that had already passed — OBD 9108185689
 * went from a stored 2026-07-25 10:30 to a computed 2026-07-22 12:30.
 *
 * A date-only punch still tells us the DAY, just not the time. So:
 *
 *   punch has a real time              -> pass BOTH (engine merge, unchanged)
 *   punch date-only, SAME IST day      -> pass EMAIL only. The day agrees, and
 *                                         the email is the only real clock.
 *   punch date-only, EARLIER IST day   -> pass EMAIL only. The email is already
 *                                         the later of the two, which is what
 *                                         the engine's cross-day rule would
 *                                         have chosen anyway — no past-dating.
 *   punch date-only, LATER IST day     -> pass NEITHER. We know the bill belongs
 *                                         to the later day but have no time for
 *                                         it, and anchoring to the older email
 *                                         would schedule into the past. Decline
 *                                         and let the operator choose.
 *   no email at all                    -> pass NEITHER (nothing to anchor to).
 *
 * "Pass neither" makes the engine return `no-order-datetime`, and the bill
 * reaches the operator with NO slot. That is the intended outcome, not a gap: a
 * slot in the past is worse than no slot. Do not add a fallback.
 */
export function resolvePunchClocks(
  emailDateTime: Date | null | undefined,
  punchDateTime: Date | null | undefined,
): ResolvedClocks {
  const email = emailDateTime ?? null;

  // A real punch time is the engine's normal input — hand both over untouched.
  if (hasClockTime(punchDateTime)) {
    return { emailDateTime: email, punchDateTime: punchDateTime! };
  }

  // From here the punch is unusable as a clock (absent, invalid, or date-only).
  // With no email either, there is nothing to anchor to.
  if (email === null || Number.isNaN(email.getTime())) {
    return { emailDateTime: null, punchDateTime: null };
  }

  // No punch value at all (not merely time-less) carries no day information, so
  // there is no cross-day question to answer — the email stands alone.
  if (punchDateTime == null || Number.isNaN(punchDateTime.getTime())) {
    return { emailDateTime: email, punchDateTime: null };
  }

  // Date-only punch: the DAY is still trustworthy even though the time is not.
  // Lexical compare of zero-padded YYYY-MM-DD is a calendar compare.
  if (istDay(punchDateTime) > istDay(email)) {
    return { emailDateTime: null, punchDateTime: null };
  }

  return { emailDateTime: email, punchDateTime: null };
}
