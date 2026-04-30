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
