// Pure status derivation for the admin attendance roster.
//
// Edge-safe: no Prisma, no node:* imports. Reused by both the server
// component (P9 Group A page) and the CSV export endpoint (Group D).

export type AdminDisplayStatus =
  | "EXEMPT"
  | "PRESENT"
  | "LATE"
  | "HALF_DAY"
  | "INCOMPLETE"
  | "ABSENT"
  | "HOLIDAY"
  | "ON_LEAVE"
  | "NOT_IN_YET";

interface DeriveStatusArgs {
  attendanceExempt: boolean;
  summaryStatus: string | null;
  hasFirstCheckIn: boolean;
  recordCount: number;
  isToday: boolean;
  nowMinIST: number;
  workStartMin: number;
  lateGraceMinutes: number;
}

/**
 * Derive a single display status for one user on the viewed date.
 *
 * Precedence:
 *   1. attendanceExempt user           → "EXEMPT"
 *   2. summary row exists with a known status → use it
 *   3. records exist but no summary    → "INCOMPLETE" (defensive)
 *   4. no data, today, before workStart+grace → "NOT_IN_YET"
 *   5. no data, today, past grace      → "ABSENT" (provisional)
 *   6. no data, past date              → "ABSENT"
 */
export function deriveAdminUserStatus(args: DeriveStatusArgs): AdminDisplayStatus {
  const {
    attendanceExempt,
    summaryStatus,
    hasFirstCheckIn,
    recordCount,
    isToday,
    nowMinIST,
    workStartMin,
    lateGraceMinutes,
  } = args;

  if (attendanceExempt) return "EXEMPT";

  if (summaryStatus) {
    if (
      summaryStatus === "PRESENT" ||
      summaryStatus === "LATE" ||
      summaryStatus === "HALF_DAY" ||
      summaryStatus === "INCOMPLETE" ||
      summaryStatus === "ABSENT" ||
      summaryStatus === "HOLIDAY" ||
      summaryStatus === "ON_LEAVE"
    ) {
      return summaryStatus;
    }
    return "INCOMPLETE";
  }

  // Records may exist without a summary in race conditions or partial
  // data states — treat as INCOMPLETE so admin sees "needs attention".
  // (Touching `hasFirstCheckIn` keeps the call site flexible if we later
  // want a separate "checked-in but summary missing" branch.)
  if (recordCount > 0 || hasFirstCheckIn) return "INCOMPLETE";

  if (isToday) {
    return nowMinIST < workStartMin + lateGraceMinutes ? "NOT_IN_YET" : "ABSENT";
  }
  return "ABSENT";
}
