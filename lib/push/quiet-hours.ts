// Depot working-hours gate for push notifications.
//
// TIMEZONE LANDMINE: Vercel runs in UTC; the depot is IST (Asia/Kolkata,
// UTC+5:30). A naive date.getHours() reads the UTC hour and would silence the
// real working day while buzzing at night. We shift the instant by the IST
// offset and read the UTC hour off the shifted value — the same idiom
// lib/picking/queue.ts uses (getISTTodayDate). IST has no DST, so this is exact
// year-round.

/** 09:00 inclusive (IST). */
export const DEPOT_HOURS_START_IST = 9;
/** 20:00 exclusive (IST). */
export const DEPOT_HOURS_END_IST = 20;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * True when `date` falls within [09:00, 20:00) IST. When false, callers DROP the
 * notification entirely — it is NOT queued for later, because the work is still
 * on the board the next time they open the app.
 */
export function isWithinDepotHours(date: Date): boolean {
  const hourIST = new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
  return hourIST >= DEPOT_HOURS_START_IST && hourIST < DEPOT_HOURS_END_IST;
}
