// Pure calendar/month math for the attendance history view.
// Edge-safe (Intl + plain JS only, no Prisma, no node:* imports).

import { istDateString } from "./date";

export interface MonthRef {
  year: number;
  month: number; // 1–12
}

export interface DayCell {
  date: string;          // YYYY-MM-DD
  isCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
});

function formatDateUTC(d: Date): string {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Current IST month, derived from istDateString. */
export function getCurrentIstMonth(): MonthRef {
  const today = istDateString();
  const [y, mo] = today.split("-");
  return { year: parseInt(y ?? "0", 10), month: parseInt(mo ?? "0", 10) };
}

/**
 * Parse a "YYYY-MM" string to a MonthRef. Returns the current IST month
 * if missing, malformed, or out of a sane bound range. The server always
 * renders a valid month — invalid URLs are silently corrected, not errored.
 */
export function parseMonthParam(s: string | undefined): MonthRef {
  if (!s) return getCurrentIstMonth();
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return getCurrentIstMonth();
  const year = parseInt(m[1] ?? "0", 10);
  const month = parseInt(m[2] ?? "0", 10);
  if (!Number.isFinite(year) || year < 2020 || year > 2099) {
    return getCurrentIstMonth();
  }
  if (month < 1 || month > 12) return getCurrentIstMonth();
  return { year, month };
}

/** Add N months (can be negative). Wraps year boundaries correctly. */
export function addMonths(ref: MonthRef, delta: number): MonthRef {
  const idx = ref.year * 12 + (ref.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12 + 1;
  return { year, month };
}

/** -1, 0, or 1. Total-ordering compare on (year, month). */
export function compareMonths(a: MonthRef, b: MonthRef): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  return 0;
}

/**
 * Clamp `m` to [current - monthsBack, current]. Used at the page level
 * after parsing so a URL like ?month=2024-01 gets corrected to the min
 * allowed month rather than 404-ing.
 */
export function clampMonth(m: MonthRef, monthsBack: number): MonthRef {
  const current = getCurrentIstMonth();
  const min = addMonths(current, -monthsBack);
  if (compareMonths(m, min) < 0) return min;
  if (compareMonths(m, current) > 0) return current;
  return m;
}

/** "May 2026". Same Intl-cached pattern as lib/attendance/format.ts. */
export function formatMonthLabel(m: MonthRef): string {
  return monthLabelFormatter.format(new Date(Date.UTC(m.year, m.month - 1, 1)));
}

/**
 * Build the 42-cell (6 weeks × 7 days) grid for a given month, starting
 * on the Monday of the week containing the 1st. Always rectangular so
 * the calendar layout stays stable regardless of which weekday the
 * month starts on.
 *
 * Each cell carries `isCurrentMonth` (false = greyed-out neighbour),
 * `isToday` (used for the teal highlight), and `isFuture` (used to
 * disable interaction).
 */
export function getMonthGrid({ year, month }: MonthRef): DayCell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Monday-first weekday: 0=Mon, …, 6=Sun.
  const dayOfWeek = (firstOfMonth.getUTCDay() + 6) % 7;
  // Grid starts on the Monday of the week containing the 1st.
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - dayOfWeek));

  const todayIST = istDateString();
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000);
    const dateStr = formatDateUTC(d);
    cells.push({
      date: dateStr,
      isCurrentMonth:
        d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month,
      isToday: dateStr === todayIST,
      // Lexical compare on YYYY-MM-DD is order-correct.
      isFuture: dateStr > todayIST,
    });
  }
  return cells;
}
