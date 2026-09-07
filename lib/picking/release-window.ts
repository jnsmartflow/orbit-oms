// Picking — the manual early-release WINDOW rule.
//
// PURE. Zero imports, no Date.now(), no clock read anywhere inside: the caller
// supplies "today". Same discipline as lib/picking/picker-split.ts, and for the
// same reason — this rule is asked on BOTH sides (the server route that writes
// orders.pickEarlyReleasedAt, and the board that decides whether to offer the
// action), and two hosts must never answer it differently.
//
// ─── THE RULE ───────────────────────────────────────────────────────────────
// A supervisor may release an upcoming (future-dated) bill early ONLY on the
// LAST WORKING DAY before its dispatch date.
//
//   bill dated Sat  ->  releasable on Fri only
//   bill dated Mon  ->  releasable on Sat only   (Sunday is skipped)
//   bill dated Wed  ->  releasable on Tue only
//   anything further out  ->  false
//
// SUNDAY IS THE ONLY NON-WORKING DAY. The depot is closed on Sunday; Saturday
// IS a working day; HOLIDAYS ARE NOT MODELLED — one day, one rule. That is the
// same rule the dispatch engine's "next working day" already applies, stated
// once more here in the opposite direction.
//
// ─── DATE HANDLING ──────────────────────────────────────────────────────────
// Date-only ISO strings ("YYYY-MM-DD") end to end. Parsing is ONLY by
// split("-") fed into Date.UTC(y, m - 1, d); formatting back is by hand. Never
// `new Date(someString)` — CORE §3's offset-less-Date.parse rule. An
// offset-less string is read in the HOST's timezone, so the identical call
// would land on a different calendar day on Vercel (UTC) and on a depot phone
// (Asia/Kolkata, +5:30) — and only near midnight, which is exactly the class of
// bug that passes every daytime test. The Date objects built here are internal
// scratch for the weekday lookup and never leave the module.
//
// ─── ⚠ DELIBERATE DUPLICATION — MIRROR ANY CHANGE ───────────────────────────
// previousWorkingDateOnlyUTC() below duplicates the six-line Sunday rule in
// lib/dispatch/dispatch-engine.ts's PRIVATE nextWorkingDateOnlyUTC().
//
// That helper is module-private BY DESIGN: its file's contract is "pure
// functions only — no prisma, no I/O, no Date.now()", scoped to RULE 1 slot
// assignment at enrichment. Exporting it would make an enrichment-owned file a
// picking dependency, for six lines. This is the same call
// app/api/picking/release/route.ts already made when it re-derived
// getISTTodayDateOnly() rather than reaching into lib/picking/queue.ts's
// private one.
//
// 🔴 A CHANGE TO THE SUNDAY RULE MUST BE MIRRORED IN BOTH PLACES:
//      lib/dispatch/dispatch-engine.ts  nextWorkingDateOnlyUTC()  (forwards)
//      lib/picking/release-window.ts    previousWorkingDateOnlyUTC()  (back)
//    If holidays are ever modelled, that is the moment to promote the rule to
//    one shared owner rather than adding a third copy.
// ────────────────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-MM-DD" -> a UTC-midnight Date, used ONLY to read getUTCDay() and to
 * step a day. Throws on a malformed or impossible calendar date (e.g.
 * "2026-02-30", which Date.UTC would silently roll into March) — the same
 * choice lib/picking/queue.ts's resolveTargetDate() made: a derived rule that
 * quietly answers a different question than it was asked is worse than one
 * that stops.
 */
function parseIsoDateOnly(isoDate: string): Date {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`Invalid date "${isoDate}" — expected YYYY-MM-DD`);
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (formatIsoDateOnly(parsed) !== isoDate) {
    throw new Error(`Invalid calendar date "${isoDate}"`);
  }
  return parsed;
}

/** A UTC-midnight Date -> "YYYY-MM-DD", built by hand from the UTC parts. */
function formatIsoDateOnly(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The last WORKING day before `isoDate`, as "YYYY-MM-DD".
 *
 * One calendar day back; if that lands on a Sunday (getUTCDay() === 0), one
 * more day back. A SINGLE extra step is sufficient and correct — two Sundays
 * are never adjacent, so the second step can never land on one. Date.UTC
 * normalises the d-1 / d-2 underflow across month and year boundaries.
 *
 * Sunday-only, holidays not modelled — see the file header.
 */
export function previousWorkingDateOnlyUTC(isoDate: string): string {
  const date = parseIsoDateOnly(isoDate);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  const candidate = new Date(Date.UTC(y, m, d - 1));
  const previous = candidate.getUTCDay() === 0 ? new Date(Date.UTC(y, m, d - 2)) : candidate;
  return formatIsoDateOnly(previous);
}

/**
 * Is manual early release available for this bill TODAY?
 *
 * True only when all three hold:
 *   - the bill has a dispatch date at all (a null-dated bill is already "due";
 *     lib/picking/queue.ts sorts it to zone "due", never "upcoming", so there
 *     is nothing to unlock);
 *   - that date is still in the FUTURE relative to today (a plain string
 *     compare is exact on zero-padded "YYYY-MM-DD" and needs no Date at all);
 *   - today IS the last working day before it.
 *
 * False in every other case — null, today itself, any past date, any date
 * further out than one working day, and any malformed input.
 *
 * ⚠ THIS IS ABOUT THE ACTION, NEVER ABOUT WHERE THE BILL SITS. A bill already
 * released early carries pickEarlyReleasedAt and is forced zone "due" by
 * lib/picking/queue.ts on every later day; this function will report false for
 * it the day after, which is correct — the action is spent, the bill stays due.
 * Do not fold the two questions together.
 */
export function isReleasableToday(
  dispatchTargetDate: string | null,
  todayIsoDate: string,
): boolean {
  if (dispatchTargetDate === null) return false;
  if (!ISO_DATE_RE.test(dispatchTargetDate) || !ISO_DATE_RE.test(todayIsoDate)) return false;
  if (dispatchTargetDate <= todayIsoDate) return false;
  return todayIsoDate === previousWorkingDateOnlyUTC(dispatchTargetDate);
}
