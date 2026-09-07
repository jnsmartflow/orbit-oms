/**
 * READ-ONLY smoke test (2026-09-07) — the picking early-release WINDOW rule.
 *
 * NO DATABASE ACCESS. Pure function calls against lib/picking/release-window.ts:
 * a supervisor may release an upcoming bill early ONLY on the last WORKING day
 * before its dispatch date, Sunday being the only non-working day.
 *
 * The week is PINNED, never today's real date — a date rule whose test moves
 * with the calendar tests a different thing every day, and the Saturday→Monday
 * case (the whole reason the Sunday skip exists) would only be exercised once a
 * week. Pinned week, verified weekdays:
 *
 *   2026-09-11 Fri   2026-09-12 Sat   2026-09-13 SUN   2026-09-14 Mon
 *   2026-09-15 Tue   2026-09-16 Wed   2026-09-17 Thu   2026-09-18 Fri
 *
 * Exits non-zero if any row disagrees.
 *
 * Run: npx tsx scripts/_smoke-release-window.ts
 */
import { isReleasableToday, previousWorkingDateOnlyUTC } from "../lib/picking/release-window";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday label for the table only — never used by the rule under test. */
function dayName(iso: string | null): string {
  if (iso === null) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "??";
  const [y, m, d] = iso.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

interface Case {
  dispatch: string | null;
  today: string;
  expected: boolean;
  note: string;
}

const CASES: Case[] = [
  // ── The core window, one working day back ────────────────────────────────
  { dispatch: "2026-09-12", today: "2026-09-11", expected: true,  note: "Sat bill, Fri today" },
  { dispatch: "2026-09-12", today: "2026-09-10", expected: false, note: "Sat bill, Thu today — too far out" },

  // ── THE SUNDAY SKIP — the whole reason this rule is not "yesterday" ──────
  { dispatch: "2026-09-14", today: "2026-09-12", expected: true,  note: "Mon bill, Sat today — Sunday skipped" },
  { dispatch: "2026-09-14", today: "2026-09-13", expected: false, note: "Mon bill, SUN today — depot closed" },
  { dispatch: "2026-09-14", today: "2026-09-11", expected: false, note: "Mon bill, Fri today — too far out" },

  // ── A plain midweek pair, no Sunday anywhere near it ─────────────────────
  { dispatch: "2026-09-16", today: "2026-09-15", expected: true,  note: "Wed bill, Tue today" },
  { dispatch: "2026-09-16", today: "2026-09-14", expected: false, note: "Wed bill, Mon today — too far out" },

  // ── Not future-dated at all: nothing to unlock ───────────────────────────
  { dispatch: "2026-09-16", today: "2026-09-16", expected: false, note: "same date — already due" },
  { dispatch: "2026-09-16", today: "2026-09-17", expected: false, note: "today is LATER — already due/overdue" },
  { dispatch: "2026-09-12", today: "2026-09-18", expected: false, note: "well past — already due/overdue" },

  // ── No dispatch date: zone 'due' by rule, never locked ───────────────────
  { dispatch: null, today: "2026-09-15", expected: false, note: "null date, midweek" },
  { dispatch: null, today: "2026-09-13", expected: false, note: "null date, Sunday" },

  // ── Month and year boundaries — Date.UTC must carry the borrow ───────────
  { dispatch: "2026-10-01", today: "2026-09-30", expected: true,  note: "Thu 1 Oct bill, Wed 30 Sep — month boundary" },
  { dispatch: "2027-01-01", today: "2026-12-31", expected: true,  note: "Fri 1 Jan bill, Thu 31 Dec — year boundary" },
  { dispatch: "2026-11-02", today: "2026-10-31", expected: true,  note: "Mon 2 Nov bill, Sat 31 Oct — Sunday + month" },

  // ── Malformed input must be false, never a throw ─────────────────────────
  { dispatch: "not-a-date", today: "2026-09-15", expected: false, note: "malformed dispatch date" },
  { dispatch: "2026-09-16", today: "15/09/2026", expected: false, note: "malformed today" },
];

// ── previousWorkingDateOnlyUTC() on its own, incl. the borrow cases ─────────
const PREV: Array<{ input: string; expected: string; note: string }> = [
  { input: "2026-09-12", expected: "2026-09-11", note: "Sat -> Fri" },
  { input: "2026-09-14", expected: "2026-09-12", note: "Mon -> Sat (Sunday skipped)" },
  { input: "2026-09-16", expected: "2026-09-15", note: "Wed -> Tue" },
  { input: "2026-09-13", expected: "2026-09-12", note: "Sun -> Sat (input itself a Sunday)" },
  { input: "2026-10-01", expected: "2026-09-30", note: "month boundary" },
  { input: "2027-01-01", expected: "2026-12-31", note: "year boundary" },
  { input: "2026-11-02", expected: "2026-10-31", note: "Sunday skip across a month boundary" },
  { input: "2026-03-01", expected: "2026-02-28", note: "non-leap February" },
  { input: "2028-03-01", expected: "2028-02-29", note: "leap February" },
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

let failures = 0;

console.log("\nprevious WORKING day  (Sunday is the only non-working day)\n");
console.log(
  pad("input", 14) + pad("", 6) + pad("expected", 18) + pad("actual", 18) + pad("ok", 5) + "note",
);
console.log("-".repeat(96));
for (const c of PREV) {
  let actual: string;
  try {
    actual = previousWorkingDateOnlyUTC(c.input);
  } catch (err) {
    actual = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ok = actual === c.expected;
  if (!ok) failures++;
  console.log(
    pad(c.input, 14) +
      pad(dayName(c.input), 6) +
      pad(`${c.expected} ${dayName(c.expected)}`, 18) +
      pad(actual.startsWith("THREW") ? actual : `${actual} ${dayName(actual)}`, 18) +
      pad(ok ? "OK" : "FAIL", 5) +
      c.note,
  );
}

console.log("\n\nisReleasableToday(dispatchTargetDate, today)\n");
console.log(
  pad("dispatch date", 18) +
    pad("today", 18) +
    pad("expected", 10) +
    pad("actual", 10) +
    pad("ok", 5) +
    "note",
);
console.log("-".repeat(112));
for (const c of CASES) {
  let actual: boolean | string;
  try {
    actual = isReleasableToday(c.dispatch, c.today);
  } catch (err) {
    actual = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ok = actual === c.expected;
  if (!ok) failures++;
  console.log(
    pad(c.dispatch === null ? "null" : `${c.dispatch} ${dayName(c.dispatch)}`, 18) +
      pad(`${c.today} ${dayName(c.today)}`, 18) +
      pad(String(c.expected), 10) +
      pad(String(actual), 10) +
      pad(ok ? "OK" : "FAIL", 5) +
      c.note,
  );
}

const total = PREV.length + CASES.length;
console.log(
  `\n${total - failures}/${total} passed${failures > 0 ? ` — ${failures} FAILED` : ""}\n`,
);
process.exit(failures > 0 ? 1 : 0);
