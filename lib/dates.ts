// lib/dates.ts
//
// Server-safe date helpers (no Prisma, no node:* imports). Importable from
// both server modules and client components.

/**
 * Today's date as ISO string (YYYY-MM-DD) in IST. Matches the format
 * accepted by HTML <input type="date"> and used by the daily cleanup job.
 */
export function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * IST midnight-to-midnight expressed as UTC Date boundaries (half-open interval).
 * start = IST 00:00:00 as UTC, end = start + 24 h (= next IST midnight as UTC).
 * If dateStr (YYYY-MM-DD) is omitted, defaults to today IST.
 * Mirrors the identical private helper in app/api/mail-orders/route.ts.
 */
export function getISTDayRange(dateStr?: string): { start: Date; end: Date } {
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30

  let year: number, month: number, day: number;
  if (dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    const istNow = new Date(Date.now() + istOffset);
    year = istNow.getUTCFullYear();
    month = istNow.getUTCMonth() + 1;
    day = istNow.getUTCDate();
  }

  // Midnight IST → UTC
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - istOffset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
