// components/mrn/format.ts
//
// The MRN billing board's display formatters, in one place so the rail card,
// the header card and the detail pane cannot drift on how a date reads.
//
// ⚠️ TWO DIFFERENT DATE SHAPES CROSS THIS BOUNDARY AND THEY ARE NOT
// INTERCHANGEABLE. Getting them mixed up shows the operator the wrong day.
//
//   • `mrnDate` and `truckReportingDate` are @db.Date — DATE-ONLY. Prisma hands
//     them back anchored at UTC MIDNIGHT, so their UTC parts ARE their calendar
//     parts (the same fact lib/mrn/number.ts's yearOf() documents). They must be
//     read with UTC getters: local getters render the PREVIOUS day for any
//     viewer west of UTC. → formatDateOnly
//
//   • `createdAt`, `unloadingStartAt`, `unloadingEndAt` are timestamptz — real
//     instants. They must be rendered in IST, because the floor reads IST.
//     → formatIstTime / formatIstDateTime
//
// ⚠️ AND EVERY ONE OF THEM ARRIVES AS A STRING, not a Date. lib/mrn/types.ts
// types them `Date` because that is what Prisma returns server-side, but these
// values reach this board through NextResponse.json(), which serialises a Date
// to an ISO string. The declared type is therefore a lie on the client — the
// same hazard lib/picking/types.ts avoids by declaring `Date | string | null`
// outright. Rather than cast at ~15 call sites, every helper here accepts BOTH
// and normalises once. Do not "tidy" these signatures down to Date.

type WireDate = Date | string | null | undefined;

function toDate(v: WireDate): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A @db.Date as "17 Aug 2026". UTC getters — see this file's header.
 * Never use this on a timestamptz: it would report the UTC calendar day, which
 * is the previous day for anything before 05:30 IST.
 */
export function formatDateOnly(v: WireDate): string | null {
  const d = toDate(v);
  if (!d) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A timestamptz as "11:04" IST. */
export function formatIstTime(v: WireDate): string | null {
  const d = toDate(v);
  if (!d) return null;
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A timestamptz as "20 Aug 11:06" IST. */
export function formatIstDateTime(v: WireDate): string | null {
  const d = toDate(v);
  if (!d) return null;
  const day = d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });
  return `${day} ${formatIstTime(d)}`;
}

/** Elapsed time between two timestamptz values as "1h 36m" / "48m". */
export function formatDuration(start: WireDate, end: WireDate): string | null {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return null;
  const mins = Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * A batch's manufacturing or best-before pair as "06/26".
 *
 * ⚠ Both halves are STORED integers the supervisor typed. Best before is never
 * derived from mfg (design §11 OQ-9 — shelf life varies by product), and this
 * function does no arithmetic of any kind: it takes two numbers and prints
 * them. Do not add a month/year rollover here.
 */
export function formatMonthYear(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

/** Quantities with Indian thousands grouping, matching the mockup's "1,982". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-IN");
}

/**
 * The date param the board sends to /api/mrn/board?face=billing.
 *
 * LOCAL getters, deliberately: the value comes from HeaderDateStepper, whose
 * calendar builds plain local-midnight Dates (components/ui/date-picker-popover.tsx).
 * Reading it with UTC getters would send the previous day's date for any viewer
 * east of UTC — which is every user of this depot. Same convention as
 * components/tint/ti-report-content.tsx.
 */
export function toDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
