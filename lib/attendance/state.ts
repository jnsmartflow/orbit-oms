// Pure attendance state derivation.
//
// No Prisma, no node:* imports — Edge-safe and trivially unit-testable.
// Server component reads attendance_records via Prisma and feeds the
// rows in here. The shape is deliberately loose (`type: string`,
// `timestamp: Date | string`) so callers don't have to import Prisma
// types into edge contexts.

export interface SessionPair {
  checkInISO: string;
  checkOutISO: string;
  durationMinutes: number;
}

export type AttendanceState =
  | {
      kind: "NOT_CHECKED_IN";
      lastCheckOutISO: string | null;
      todayMinutes: number;
      sessions: SessionPair[];
    }
  | {
      kind: "WORKING";
      currentSessionStartISO: string;
      minutesBefore: number;
      sessionsBefore: SessionPair[];
    };

interface RecordInput {
  type: string;
  timestamp: Date | string;
}

const CHECK_IN = "CHECK_IN";
const CHECK_OUT = "CHECK_OUT";

function toISO(t: Date | string): string {
  return typeof t === "string" ? t : t.toISOString();
}

function durationMinutes(startISO: string, endISO: string): number {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

/**
 * Walk records (sorted ASC by timestamp) and produce the user's
 * current attendance state for today.
 *
 * Caller is expected to pass attendance_records for today's IST date
 * only — cross-midnight sessions are out of scope (Prompt 5 §6).
 *
 * Malformed-record handling:
 *   - Back-to-back CHECK_INs: first wins, subsequent ignored. The P6
 *     check-in API will validate against this server-side, so this is
 *     defensive only.
 *   - CHECK_OUT with no matching CHECK_IN: silently dropped. The
 *     nightly summary job (Prompt 9) flags the day as INCOMPLETE.
 */
export function deriveAttendanceState(records: readonly RecordInput[]): AttendanceState {
  const sessions: SessionPair[] = [];
  let openCheckInISO: string | null = null;

  for (const r of records) {
    const ts = toISO(r.timestamp);
    if (r.type === CHECK_IN) {
      if (openCheckInISO === null) {
        openCheckInISO = ts;
      }
    } else if (r.type === CHECK_OUT) {
      if (openCheckInISO !== null) {
        sessions.push({
          checkInISO: openCheckInISO,
          checkOutISO: ts,
          durationMinutes: durationMinutes(openCheckInISO, ts),
        });
        openCheckInISO = null;
      }
    }
  }

  const completedMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);

  if (openCheckInISO !== null) {
    return {
      kind: "WORKING",
      currentSessionStartISO: openCheckInISO,
      minutesBefore: completedMinutes,
      sessionsBefore: sessions,
    };
  }

  const lastSession = sessions[sessions.length - 1];
  return {
    kind: "NOT_CHECKED_IN",
    lastCheckOutISO: lastSession?.checkOutISO ?? null,
    todayMinutes: completedMinutes,
    sessions,
  };
}
