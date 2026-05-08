// IST clock + duration formatters for attendance UI.
//
// Edge-safe: Intl + plain JS only, no Prisma, no node:* imports.
// Sibling to lib/attendance/date.ts (which handles calendar dates);
// this module handles wall-clock and duration formatting.

const IST_TZ = "Asia/Kolkata";

const clockFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Used to derive "minutes since IST midnight" by formatting and reparsing.
// 24h locale chosen so the parse step is unambiguous.
const istHourMinuteFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const istWeekdayDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
});

const istShortDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});

function dateFromIstDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Format an ISO timestamp (or Date) as "8:42 AM" in IST. */
export function formatIstClock(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return clockFormatter.format(d);
}

/** Convert "HH:MM" 24h time string to "H:MM AM/PM". */
export function format24To12(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${period}`;
}

/** Format minutes into "Xh Ym" / "Ym" / "0m". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Whole minutes between an ISO start and a `now` timestamp (ms). */
export function minutesSince(startISO: string, nowMs: number = Date.now()): number {
  const startMs = new Date(startISO).getTime();
  return Math.max(0, Math.round((nowMs - startMs) / 60_000));
}

/** Parse "HH:MM" 24h into minutes since midnight (e.g. "09:30" → 570). */
export function parseTimeToMin(time24: string): number {
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  return h * 60 + m;
}

/**
 * Minutes since IST midnight for a given instant (defaults to now).
 * Format-and-reparse: cheap and timezone-correct without Date math.
 */
export function istMinutesSinceMidnight(date: Date | number = Date.now()): number {
  const d = typeof date === "number" ? new Date(date) : date;
  const [h, m] = istHourMinuteFormatter.format(d).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "2026-05-08" → "Friday, May 8" in IST. */
export function formatIstWeekdayDate(dateStr: string): string {
  return istWeekdayDateFormatter.format(dateFromIstDateString(dateStr));
}

/** "2026-05-07" → "Thu, May 7" in IST. */
export function formatIstShortDate(dateStr: string): string {
  return istShortDateFormatter.format(dateFromIstDateString(dateStr));
}

/**
 * Shift a "YYYY-MM-DD" calendar date back N days. Anchored on UTC
 * midnight purely for stable arithmetic — IST has no DST so this is
 * timezone-correct. Used by both the server page (for the past-week
 * window) and the client home (for stats / recent days).
 */
export function shiftCalendarDate(dateStr: string, daysBack: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const shifted = new Date(utc - daysBack * 86_400_000);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
