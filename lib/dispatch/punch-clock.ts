// ─────────────────────────────────────────────────────────
// Does this timestamp actually carry a TIME OF DAY?
//
// THE SINGLE OWNER of this question. Import it; never write a second copy.
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
