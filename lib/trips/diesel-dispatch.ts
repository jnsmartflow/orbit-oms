// lib/trips/diesel-dispatch.ts — a trip's DIESEL AMOUNT and MANUAL DISPATCH
// TIME (Schema v27.54, 2026-10-04, Smart Flow).
//
// trips."dieselAmount" numeric(10,2), NULL or >= 0 (chk_trips_diesel_amount_nonneg),
// optional. trips."manualDispatchAt" timestamptz, nullable in the DB but
// REQUIRED in the Edit drawer — old trips are completed on their next save.
//
// 🔴 THE MANUAL DISPATCH TIME IS FOR REPORTS ONLY. It never writes
// `dispatchedAt`, never moves `status`, never closes a trip — `dispatchedAt`
// belongs to chk_trips_dispatched_complete and the (caller-less) dispatch route.
//
// ⚠ IST, ALWAYS WITH AN OFFSET. A date/time input gives an offset-less string,
// which the browser and Vercel read 5.5 hours apart (CORE §3). The drawer sends
// `${date}T${hh}:${mm}:00+05:30`; the route refuses anything without Z or ±hh:mm.
//
// PURE — shared by the PATCH route, the activity log and the drawer/header.

const IST = "Asia/Kolkata";

/** numeric(10,2) holds at most 99,999,999.99. */
export const DIESEL_MAX = 99_999_999.99;

/**
 * A request body value → rupees as a number (2 dp), or null to clear.
 * Accepts a number or a numeric string; refuses NaN, negative, more than two
 * decimals and anything above DIESEL_MAX.
 */
export function parseDieselAmount(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  let n: number;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return { ok: true, value: null };
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false };
    n = Number(s);
  } else if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return { ok: false };
    // More than two decimals — compared with a tolerance, since 0.1 + 0.2 is not 0.3.
    if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return { ok: false };
    n = v;
  } else {
    return { ok: false };
  }
  if (!Number.isFinite(n) || n < 0 || n > DIESEL_MAX) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** ISO date-time WITH an explicit offset: Z or ±hh:mm. */
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A request body value → a Date. Null is refused: the field is required. */
export function parseManualDispatchAt(v: unknown): { ok: true; value: Date } | { ok: false; error: string } {
  if (v === null || v === undefined) {
    return { ok: false, error: "manualDispatchAt is required and cannot be cleared" };
  }
  if (typeof v !== "string" || !OFFSET_ISO.test(v)) {
    return { ok: false, error: "manualDispatchAt must be an ISO date-time with an offset (Z or ±hh:mm)" };
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "manualDispatchAt is not a valid date-time" };
  }
  return { ok: true, value: d };
}

/** The drawer's two inputs → the string the route accepts. */
export function manualDispatchIso(date: string, time: string): string {
  return `${date}T${time}:00+05:30`;
}

/** Today in IST as YYYY-MM-DD — never the browser's UTC day. */
export function istTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

/** An instant → its IST date (YYYY-MM-DD) and time (HH:MM, 24h), for the inputs. */
export function istDateAndTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * The two inputs' starting values for a trip (Floor or Freight): the stored
 * instant shown in IST, or — nothing stored — today's IST date and an EMPTY
 * time, so the planner must type it.
 */
export function initialManualDispatch(iso: string | null): { date: string; time: string } {
  return iso !== null ? istDateAndTime(iso) : { date: istTodayDate(), time: "" };
}

/** "6:40 pm" in IST. */
export function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
}

/** "4 Oct, 6:40 pm" in IST. */
export function formatIstDayTime(iso: string): string {
  const day = new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
  return `${day}, ${formatIstTime(iso)}`;
}

/** "₹1,250" — or "₹1,250.50" when there are paise. */
export function formatRupees(n: number): string {
  const whole = Number.isInteger(n);
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
