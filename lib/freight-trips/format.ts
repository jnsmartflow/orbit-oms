// lib/freight-trips/format.ts — the freight trip number and the date it is built on.
//
// PURE and CLIENT-SAFE (no Prisma, no clock) so a preview, a test and the
// allocator share ONE rule. An own copy on purpose — NOT lib/trips/number.ts,
// which owns Orbit's L/U/I/C trips and reuses cancelled numbers; freight
// numbers are never reused (owner decision, 2026-10-02).
//
// 🔴 THE DATABASE HALF: chk_freight_trips_number_shape
//   "tripNumber" = 'F-' || to_char("tripDate",'YYMMDD') || '-'
//                  || lpad(seq::text, greatest(2, length(seq::text)), '0')
// Change one, ALTER the other first (CORE §3). Postgres lpad TRUNCATES, which is
// why the CHECK pads to greatest(2, length) — and why this pads with padStart,
// which widens and never cuts: seq 7 → "07", seq 137 → "137".

const SEQ_MIN_WIDTH = 2;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The YYMMDD half, read off a @db.Date value with UTC getters (it is UTC midnight). */
export function formatFreightDatePart(tripDate: Date): string {
  const yy = String(tripDate.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(tripDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tripDate.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/** F-YYMMDD-NN — padded to at least two digits, never truncated. */
export function formatFreightTripNumber(tripDate: Date, seq: number): string {
  return `F-${formatFreightDatePart(tripDate)}-${String(seq).padStart(SEQ_MIN_WIDTH, "0")}`;
}

/** "YYYY-MM-DD" → the UTC-midnight Date a @db.Date column holds. Throws on a bad date. */
export function parseFreightDate(dateStr: string): Date {
  if (!DATE_RE.test(dateStr)) throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.toISOString().slice(0, 10) !== dateStr) throw new Error(`Invalid calendar date "${dateStr}"`);
  return dt;
}
