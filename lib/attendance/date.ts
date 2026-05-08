// IST date helpers for the attendance gate.
//
// Edge-runtime safe: Intl only, no Prisma, no node:* imports. Imported
// directly by middleware.ts.
//
// Sibling helper: lib/dates.ts exposes getTodayIST() for the rest of the
// app. This file mirrors the same recipe (en-CA + Asia/Kolkata) but groups
// attendance-specific helpers so the middleware import path stays short.

const IST_LOCALE = "en-CA"; // en-CA renders dates as YYYY-MM-DD.
const IST_TZ = "Asia/Kolkata";

/**
 * Format a Date as "YYYY-MM-DD" in IST. Defaults to the current instant.
 * Used by middleware to compare against JWT.lastCheckInDate.
 */
export function istDateString(d: Date = new Date()): string {
  return d.toLocaleDateString(IST_LOCALE, { timeZone: IST_TZ });
}

/**
 * Current instant — a thin wrapper around `new Date()` so callers can
 * derive both an instant and an IST-formatted string from one source
 * (and tests can stub a single "now"). The returned Date holds a UTC
 * timestamp like every JS Date; format with istDateString() to get IST
 * wall-clock components.
 */
export function istNow(): Date {
  return new Date();
}
