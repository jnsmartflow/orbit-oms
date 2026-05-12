// OT (overtime) claim-and-approval decision logic.
//
// Pure function: data in, decision out. No Prisma, no node:* imports,
// no clock reads, no I/O. Sibling to lib/attendance/state.ts and
// lib/attendance/geofence.ts — same edge-safe contract so the same
// code can run in route handlers, edge middleware, or a unit test
// without a DB or filesystem in scope.
//
// Caller responsibilities (the check-out route):
//   - Read this month's grace flag count from attendance_ot_grace
//   - Pass the user's claim answer + reason from the request body
//   - Apply the returned decision to the DB (records, audit, grace,
//     summary) — this module never writes
//
// Design doc: lib/attendance/ot-logic.ts §5 of the OT workflow spec.

import {
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";

export interface OtDecisionInput {
  checkOutTimestamp: Date;
  totalMinutesWorked: number;
  // null = client didn't send the field. Tolerated; treated as "no".
  otClaimed: "yes" | "no" | null;
  // Carried through for the route's DB write; the decision tree itself
  // doesn't use it. Kept in the input shape so the route can hand the
  // whole request context to one call.
  otClaimReason: string | null;
  settings: {
    otTriggerTime: string;
    depotWorkingMinutes: number;
    otMonthlyGraceLimit: number;
    otPromptEnabled: boolean;
  };
  currentGraceFlagCount: number;
}

export type OtApprovalStatus =
  | "NOT_CLAIMED"
  | "AUTO_CREDITED"
  | "AUTO_CREDITED_GRACE"
  | "PENDING";

export type OtAuditAction =
  | "CLAIM_YES"
  | "CLAIM_NO"
  | "CONFIRMED_UNDER_95";

export interface OtDecisionOutput {
  // Raw minutes past trigger time. In-memory only — the route may
  // surface it in the response body, but it is not persisted on
  // attendance_records (only otMinutesCredited is).
  otMinutesRaw: number;
  otMinutesCredited: number;
  otTotalLessThan95: boolean;
  otApprovalStatus: OtApprovalStatus;
  incrementGraceCounter: boolean;
  auditAction: OtAuditAction;
}

// Shared zero-shape for the "no OT possible" branches (5a kill switch
// and 5b before-trigger). Audit action stays CLAIM_NO in both cases:
// the settings audit log gives us the kill-switch date boundary, so a
// separate enum value would be redundant.
function flatZeroNotClaimed(): OtDecisionOutput {
  return {
    otMinutesRaw: 0,
    otMinutesCredited: 0,
    otTotalLessThan95: false,
    otApprovalStatus: "NOT_CLAIMED",
    incrementGraceCounter: false,
    auditAction: "CLAIM_NO",
  };
}

export function decideOtOutcome(input: OtDecisionInput): OtDecisionOutput {
  const {
    checkOutTimestamp,
    totalMinutesWorked,
    otClaimed,
    settings,
    currentGraceFlagCount,
  } = input;

  // 5a. Kill switch first. If admin has disabled the OT prompt, no
  // claim is possible regardless of clock or user input. We return
  // the same shape as a before-trigger check-out so downstream code
  // has one branch to handle.
  if (!settings.otPromptEnabled) {
    return flatZeroNotClaimed();
  }

  const checkOutMinIST = istMinutesSinceMidnight(checkOutTimestamp);
  const triggerMin = parseTimeToMin(settings.otTriggerTime);

  // 5b. Before trigger time → no OT possible. Whatever the client
  // sent for otClaimed is ignored; a stale "yes" from a slow clock
  // must not credit minutes that don't exist.
  if (checkOutMinIST <= triggerMin) {
    return flatZeroNotClaimed();
  }

  // Past trigger from here down. Raw minutes are always >0.
  const otMinutesRaw = checkOutMinIST - triggerMin;
  const otTotalLessThan95 =
    totalMinutesWorked < settings.depotWorkingMinutes;

  // 5c. Past trigger but user declined (or client omitted the field).
  // Null is treated as "no" defensively — the route layer rejects
  // missing otClaimed with a 400 before reaching here, so null in
  // practice only occurs in tests or malformed callers.
  if (otClaimed !== "yes") {
    return {
      otMinutesRaw,
      otMinutesCredited: 0,
      otTotalLessThan95,
      otApprovalStatus: "NOT_CLAIMED",
      incrementGraceCounter: false,
      auditAction: "CLAIM_NO",
    };
  }

  // 5d. Claimed yes, full depot day worked → straightforward credit.
  if (!otTotalLessThan95) {
    return {
      otMinutesRaw,
      otMinutesCredited: otMinutesRaw,
      otTotalLessThan95,
      otApprovalStatus: "AUTO_CREDITED",
      incrementGraceCounter: false,
      auditAction: "CLAIM_YES",
    };
  }

  // 5e. Claimed yes, total < 9.5h, grace still available → credit
  // under grace and bump the counter. CONFIRMED_UNDER_95 because the
  // user explicitly acknowledged the short day at the prompt.
  if (currentGraceFlagCount < settings.otMonthlyGraceLimit) {
    return {
      otMinutesRaw,
      otMinutesCredited: otMinutesRaw,
      otTotalLessThan95,
      otApprovalStatus: "AUTO_CREDITED_GRACE",
      incrementGraceCounter: true,
      auditAction: "CONFIRMED_UNDER_95",
    };
  }

  // 5f. Claimed yes, total < 9.5h, grace exhausted → hold for admin.
  // Counter still bumps: per the Q4 policy, pending/rejected days
  // also consume the monthly grace allotment so abuse can't game the
  // limit by claiming after exhaustion.
  return {
    otMinutesRaw,
    otMinutesCredited: 0,
    otTotalLessThan95,
    otApprovalStatus: "PENDING",
    incrementGraceCounter: true,
    auditAction: "CONFIRMED_UNDER_95",
  };
}
