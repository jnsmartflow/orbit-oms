// lib/sap-parser/cells.ts
//
// Private cell-coercion helpers used by read-sheet.ts. Mirrors the pattern in
// app/api/import/obd/route.ts (toStr/toNum/toInt/parseDateCell) so file-format
// behaviour stays consistent across the two import paths.

/** Coerce a cell to a trimmed string. Empty input returns "". */
export function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Coerce a cell to a number. Returns null if missing or unparseable. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/** Coerce a cell to an integer. Returns null if missing or unparseable. */
export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? Math.round(v) : parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

/**
 * Coerce a cell to a string OR null (versus toStr which returns "").
 * Used where the downstream type is `string | null` and "" should be
 * normalised to null.
 */
export function toStrOrNull(v: unknown): string | null {
  const s = toStr(v);
  return s === "" ? null : s;
}
