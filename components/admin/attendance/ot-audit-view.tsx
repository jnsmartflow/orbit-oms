"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MonthPicker } from "./month-picker";
import { OtAuditStats, type DerivedStats } from "./ot-audit-stats";
import { OtAuditTable } from "./ot-audit-table";

// ────────────────────────────────────────────────────────────────────────
// Types — mirror the API's response shapes from
// app/api/admin/attendance/ot-audit/route.ts
// ────────────────────────────────────────────────────────────────────────

export interface AuditRow {
  auditId: number;
  action: string;
  performedAt: string;
  performedById: number;
  performedByName: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  recordId: number;
  attendanceDate: string;
  checkOutISO: string;
  auditedUserId: number;
  auditedUserName: string;
  otClaimReason: string | null;
  otTotalLessThan95: boolean | null;
  currentStatus: string | null;
  currentMinutesCredited: number;
}

export interface AuditSummary {
  totalAudits: number;
  claimsYes: number;
  claimsNo: number;
  adminApproves: number;
  adminRejects: number;
  flaggedDays: number;
  totalMinutesCredited: number;
}

export interface AuditResponse {
  month: string;
  userId: number | null;
  rows: AuditRow[];
  summary: AuditSummary;
}

export type OutcomeKind =
  | "AUTO"
  | "AUTO_GRACE"
  | "ADMIN_APPROVE"
  | "ADMIN_REJECT"
  | "PENDING";

export interface DayBreakdown {
  recordId: number;
  attendanceDate: string;
  checkOutISO: string;
  creditedMin: number;
  outcome: OutcomeKind;
  note: string | null;
}

export interface UserAuditSummary {
  userId: number;
  userName: string;
  daysWithOt: number;
  totalCreditedMin: number;
  autoMin: number;
  graceMin: number;
  approvedMin: number;
  pendingCount: number;  // see deviation: PENDING records carry 0 credited so we count instead
  rejectedCount: number; // same — REJECTED records always 0 credited
  days: DayBreakdown[];
}

interface OtAuditViewProps {
  initialData: AuditResponse | null; // null → future-month placeholder, no fetch
  initialMonth: string;              // YYYY-MM
  currentIstMonth: string;           // YYYY-MM — for picker bounds
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function OtAuditView({
  initialData,
  initialMonth,
  currentIstMonth,
}: OtAuditViewProps) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isFutureMonth = initialMonth > currentIstMonth;

  // Group flat AuditRow[] into UserAuditSummary[]. Memoised because
  // initialData is stable per server render — but cheap enough that the
  // memo dependency is just identity.
  const userSummaries = useMemo<UserAuditSummary[]>(() => {
    if (!initialData) return [];
    return groupByUser(initialData.rows);
  }, [initialData]);

  const derivedStats = useMemo<DerivedStats>(() => {
    if (!initialData) return EMPTY_STATS;
    return deriveStats(initialData.rows, initialData.summary);
  }, [initialData]);

  function handleMonthChange(newMonth: string) {
    if (newMonth === initialMonth) return;
    router.push(`/admin/attendance/ot-audit?month=${newMonth}`);
  }

  function handleToggle(userId: number) {
    setExpandedId((prev) => (prev === userId ? null : userId));
  }

  // Header strip with month picker (lives in body, not the UH chrome — see
  // server page for why: UH's `rightExtra` is owned by Row 2, not Row 1,
  // and we want the picker visually anchored to this view).
  const monthPickerNode = (
    <MonthPicker
      currentMonth={initialMonth}
      currentIstMonth={currentIstMonth}
      onChange={handleMonthChange}
    />
  );

  // ── Future-month placeholder ────────────────────────────────────────────
  if (isFutureMonth) {
    return (
      <>
        <div className="flex items-center justify-end mb-4">
          {monthPickerNode}
        </div>
        <EmptyCard
          icon="📈"
          title="Future month selected"
          subtitle="OT audit only shows past and current months."
        />
      </>
    );
  }

  // ── No-data month ──────────────────────────────────────────────────────
  if (!initialData || initialData.rows.length === 0 || userSummaries.length === 0) {
    return (
      <>
        <div className="flex items-center justify-end mb-4">
          {monthPickerNode}
        </div>
        <OtAuditStats stats={derivedStats} />
        <EmptyCard
          icon="📅"
          title={`No OT activity in ${formatMonthLabel(initialMonth)}`}
          subtitle="Nothing was credited, claimed, or actioned this month."
        />
      </>
    );
  }

  // ── Populated ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex items-center justify-end mb-4">{monthPickerNode}</div>
      <OtAuditStats stats={derivedStats} />
      <OtAuditTable
        userSummaries={userSummaries}
        expandedId={expandedId}
        onToggle={handleToggle}
      />
      <p className="text-[11px] text-gray-400 mt-3 tabular-nums">
        {userSummaries.length} user{userSummaries.length === 1 ? "" : "s"} with OT
        activity in {formatMonthLabel(initialMonth)}
      </p>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const EMPTY_STATS: DerivedStats = {
  totalCreditedMin: 0,
  autoCreditedMin: 0,
  graceCreditedMin: 0,
  adminApprovedMin: 0,
  pendingCount: 0,
  rejectedCount: 0,
};

function EmptyCard({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
      <div className="text-4xl mb-3" aria-hidden>
        {icon}
      </div>
      <p className="text-[14px] font-semibold text-gray-900 mb-1">{title}</p>
      <p className="text-[12px] text-gray-500">{subtitle}</p>
    </div>
  );
}

// Map a record's currentStatus to a UI outcome bucket. Returns null for
// statuses that don't represent OT activity (NOT_CLAIMED) — those records
// are filtered out of every view.
function statusToOutcome(currentStatus: string | null): OutcomeKind | null {
  switch (currentStatus) {
    case "AUTO_CREDITED":
      return "AUTO";
    case "AUTO_CREDITED_GRACE":
      return "AUTO_GRACE";
    case "APPROVED":
      return "ADMIN_APPROVE";
    case "REJECTED":
      return "ADMIN_REJECT";
    case "PENDING":
      return "PENDING";
    default:
      return null;
  }
}

interface RecordRollup {
  recordId: number;
  userId: number;
  userName: string;
  attendanceDate: string;
  checkOutISO: string;
  outcome: OutcomeKind;
  creditedMin: number;
  note: string | null;
}

// Collapse N audit rows per record into 1 RecordRollup per record. Filters
// out NOT_CLAIMED records (currentStatus null or NOT_CLAIMED) — they aren't
// "OT activity" for the audit view.
function rollupRecords(rows: AuditRow[]): RecordRollup[] {
  const byRecord = new Map<number, AuditRow[]>();
  for (const r of rows) {
    const arr = byRecord.get(r.recordId) ?? [];
    arr.push(r);
    byRecord.set(r.recordId, arr);
  }

  const out: RecordRollup[] = [];
  for (const [recordId, audits] of Array.from(byRecord.entries())) {
    if (audits.length === 0) continue;
    // Sort audits oldest → newest so .at(-1) gives the most recent action.
    audits.sort((a: AuditRow, b: AuditRow) =>
      a.performedAt.localeCompare(b.performedAt),
    );
    const last = audits[audits.length - 1]!;
    const outcome = statusToOutcome(last.currentStatus);
    if (!outcome) continue;

    // Note priority:
    //   1. If the latest audit was an admin action (ADMIN_APPROVE / ADMIN_REJECT),
    //      surface that audit's note prefixed with "Admin {verb} by {name}".
    //   2. Otherwise fall back to the user's claim reason from the joined record.
    let note: string | null = null;
    if (last.action === "ADMIN_APPROVE" || last.action === "ADMIN_REJECT") {
      const verb = last.action === "ADMIN_APPROVE" ? "approved" : "rejected";
      const adminPrefix = `Admin ${verb} by ${last.performedByName}`;
      note = last.note ? `${adminPrefix} — ${last.note}` : adminPrefix;
    } else if (last.otClaimReason) {
      note = last.otClaimReason;
    }

    out.push({
      recordId,
      userId: last.auditedUserId,
      userName: last.auditedUserName,
      attendanceDate: last.attendanceDate,
      checkOutISO: last.checkOutISO,
      outcome,
      creditedMin: last.currentMinutesCredited ?? 0,
      note,
    });
  }
  return out;
}

function groupByUser(rows: AuditRow[]): UserAuditSummary[] {
  const records = rollupRecords(rows);
  const byUser = new Map<number, RecordRollup[]>();
  for (const rec of records) {
    const arr = byUser.get(rec.userId) ?? [];
    arr.push(rec);
    byUser.set(rec.userId, arr);
  }

  const summaries: UserAuditSummary[] = [];
  for (const [userId, recs] of Array.from(byUser.entries())) {
    if (recs.length === 0) continue;
    const userName = recs[0]!.userName;

    let autoMin = 0;
    let graceMin = 0;
    let approvedMin = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    const distinctDates = new Set<string>();

    for (const r of recs) {
      distinctDates.add(r.attendanceDate);
      switch (r.outcome) {
        case "AUTO":
          autoMin += r.creditedMin;
          break;
        case "AUTO_GRACE":
          graceMin += r.creditedMin;
          break;
        case "ADMIN_APPROVE":
          approvedMin += r.creditedMin;
          break;
        case "PENDING":
          pendingCount += 1;
          break;
        case "ADMIN_REJECT":
          rejectedCount += 1;
          break;
      }
    }

    const days: DayBreakdown[] = recs
      .map((r) => ({
        recordId: r.recordId,
        attendanceDate: r.attendanceDate,
        checkOutISO: r.checkOutISO,
        creditedMin: r.creditedMin,
        outcome: r.outcome,
        note: r.note,
      }))
      .sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));

    summaries.push({
      userId,
      userName,
      daysWithOt: distinctDates.size,
      totalCreditedMin: autoMin + graceMin + approvedMin,
      autoMin,
      graceMin,
      approvedMin,
      pendingCount,
      rejectedCount,
      days,
    });
  }

  // Sort users by totalCreditedMin desc, then name asc as a stable tiebreaker.
  summaries.sort(
    (a, b) =>
      b.totalCreditedMin - a.totalCreditedMin ||
      a.userName.localeCompare(b.userName),
  );
  return summaries;
}

function deriveStats(rows: AuditRow[], summary: AuditSummary): DerivedStats {
  const records = rollupRecords(rows);
  let autoCreditedMin = 0;
  let graceCreditedMin = 0;
  let adminApprovedMin = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  for (const r of records) {
    switch (r.outcome) {
      case "AUTO":
        autoCreditedMin += r.creditedMin;
        break;
      case "AUTO_GRACE":
        graceCreditedMin += r.creditedMin;
        break;
      case "ADMIN_APPROVE":
        adminApprovedMin += r.creditedMin;
        break;
      case "PENDING":
        pendingCount += 1;
        break;
      case "ADMIN_REJECT":
        rejectedCount += 1;
        break;
    }
  }

  // totalCreditedMin from the API summary is authoritative — it's the
  // dedupe-by-recordId sum the backend already computed. Use it as the
  // headline, even though our derived sum should match.
  return {
    totalCreditedMin: summary.totalMinutesCredited,
    autoCreditedMin,
    graceCreditedMin,
    adminApprovedMin,
    pendingCount,
    rejectedCount,
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function formatMonthLabel(monthStr: string): string {
  const [yStr, mStr] = monthStr.split("-");
  const y = parseInt(yStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return monthStr;
  }
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
