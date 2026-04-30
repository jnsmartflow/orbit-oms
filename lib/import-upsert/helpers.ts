// lib/import-upsert/helpers.ts
//
// Pure helpers used across the upsert pipeline. No DB access, no side effects.
// Mirror the logic of inline helpers in app/api/import/obd/route.ts so callers
// can adopt upsertObd without behaviour drift.

import { DIVISION_TO_SMU } from "./types";

/**
 * Map a SAP Division code to the corresponding SMU label and code stored on
 * the order. Unknown or empty division returns both nulls — caller decides
 * whether to treat as an error or proceed.
 */
export function resolveSmuFromDivision(
  division: string | null,
): { smu: string | null; smuCode: string | null } {
  if (!division) return { smu: null, smuCode: null };
  const m = DIVISION_TO_SMU[division.trim()];
  return m ? { smu: m.smu, smuCode: m.smuCode } : { smu: null, smuCode: null };
}

/**
 * Resolve slot from an IST email time string ("HH:mm"). Mirrors the inline
 * resolver in app/api/import/obd/route.ts. Null/missing time → Night (slot 4).
 */
export function resolveSlotFromTime(
  emailTime: string | null,
): { slotId: number; dispatchSlot: string } {
  if (!emailTime)             return { slotId: 4, dispatchSlot: "Night" };
  if (emailTime < "10:30")    return { slotId: 1, dispatchSlot: "Morning" };
  if (emailTime < "12:30")    return { slotId: 2, dispatchSlot: "Afternoon" };
  if (emailTime < "15:30")    return { slotId: 3, dispatchSlot: "Evening" };
  return { slotId: 4, dispatchSlot: "Night" };
}

/**
 * Combine an IST date with an "HH:mm" IST time string into a UTC Date.
 * Mirrors mergeEmailDateTime in app/api/import/obd/route.ts.
 */
export function mergeEmailDateTime(
  emailDate: Date | null,
  emailTime: string | null,
): Date | null {
  if (!emailDate || !emailTime) return emailDate;
  const [h, m] = emailTime.split(":").map(Number);
  const istMin = h * 60 + m;
  const utcMin = istMin - 330;
  const utcH   = Math.floor((((utcMin % 1440) + 1440) % 1440) / 60);
  const utcM   = ((utcMin % 60) + 60) % 60;
  const dt     = new Date(emailDate);
  dt.setUTCHours(utcH, utcM, 0, 0);
  if (utcMin < 0) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt;
}

/**
 * Format a value for inclusion in an audit-log note. Renders Date as ISO,
 * string as JSON-quoted, null/undefined as the literal "null".
 */
export function fmt(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date)              return v.toISOString();
  if (typeof v === "string")          return JSON.stringify(v);
  return String(v);
}
