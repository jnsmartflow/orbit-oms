import { prisma } from "@/lib/prisma";
import {
  OtAuditView,
  type AuditResponse,
  type AuditRow,
  type AuditSummary,
} from "@/components/admin/attendance/ot-audit-view";
import { istDateString } from "@/lib/attendance/date";

export const dynamic = "force-dynamic";

// Admin gating delegated to app/(ops)/layout.tsx (admin | ops_admin).

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const MIN_YEAR = 2024;
const MAX_YEAR = 2099;
const MAX_MONTHS_BACK = 24;

interface PageProps {
  searchParams: { month?: string | string[]; userId?: string | string[] };
}

export default async function OtAuditPage({ searchParams }: PageProps) {
  const monthRaw = singleParam(searchParams.month);
  const userIdRaw = singleParam(searchParams.userId);

  const currentIstMonth = istDateString().slice(0, 7);
  const month = parseAndClampMonth(monthRaw, currentIstMonth);
  const userId = parseUserId(userIdRaw);

  const otPendingCount = await prisma.attendance_records.count({
    where: { otApprovalStatus: "PENDING" },
  });

  // Future-month short-circuit. The API would 400 on this; the view
  // renders a friendly empty state instead. Pass null data so the view
  // knows not to render the stats strip.
  const isFutureMonth = month > currentIstMonth;

  let initialData: AuditResponse | null = null;
  if (!isFutureMonth) {
    initialData = await loadAudit(month, userId);
  }

  return (
    <OtAuditView
      initialData={initialData}
      initialMonth={month}
      currentIstMonth={currentIstMonth}
      otPendingCount={otPendingCount}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers — query-param parsing + Prisma data loader
// (the loader mirrors GET /api/admin/attendance/ot-audit — same ranges,
// same orphan defense, same dedupe-by-recordId for totalMinutesCredited.)
// ────────────────────────────────────────────────────────────────────────

function singleParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseAndClampMonth(raw: string | undefined, currentMonth: string): string {
  if (!raw || !MONTH_REGEX.test(raw)) return currentMonth;
  const [yStr, mStr] = raw.split("-");
  const y = parseInt(yStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    y < MIN_YEAR ||
    y > MAX_YEAR ||
    m < 1 ||
    m > 12
  ) {
    return currentMonth;
  }
  // Clamp to within MAX_MONTHS_BACK from current. Future months fall
  // through (the page handles them as a friendly empty state, not an
  // error; clamping forward would silently lie to the admin).
  const [curY, curM] = currentMonth.split("-").map(Number);
  if (Number.isFinite(curY) && Number.isFinite(curM)) {
    const target = y * 12 + m;
    const minIndex = (curY ?? 0) * 12 + (curM ?? 0) - MAX_MONTHS_BACK;
    if (target < minIndex) return currentMonth;
  }
  return raw;
}

function parseUserId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function loadAudit(
  month: string,
  userId: number | null,
): Promise<AuditResponse> {
  // Compute month range strings — YYYY-MM-DD lex sort = chrono sort.
  const [reqY, reqM] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const nextY = reqM === 12 ? (reqY ?? 0) + 1 : (reqY ?? 0);
  const nextM = reqM === 12 ? 1 : (reqM ?? 0) + 1;
  const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const audits = await prisma.attendance_ot_audit.findMany({
    where: {
      record: {
        attendanceDate: { gte: monthStart, lt: nextMonthStart },
        ...(userId !== null ? { userId } : {}),
      },
    },
    orderBy: { performedAt: "asc" },
    select: {
      id: true,
      recordId: true,
      userId: true,
      performedById: true,
      action: true,
      performedAt: true,
      fromStatus: true,
      toStatus: true,
      note: true,
    },
  });

  if (audits.length === 0) {
    return emptyResponse(month, userId);
  }

  // Array.from() around Set per CLAUDE_CORE §3 (target < ES2015).
  const recordIds = Array.from(new Set(audits.map((a) => a.recordId)));
  const records = await prisma.attendance_records.findMany({
    where: { id: { in: recordIds } },
    select: {
      id: true,
      attendanceDate: true,
      timestamp: true,
      otClaimReason: true,
      otTotalLessThan95: true,
      otApprovalStatus: true,
      otMinutesCredited: true,
    },
  });
  const recordById = new Map(records.map((r) => [r.id, r]));

  const userIdSet = new Set<number>();
  for (const a of audits) {
    userIdSet.add(a.userId);
    userIdSet.add(a.performedById);
  }
  const users = await prisma.users.findMany({
    where: { id: { in: Array.from(userIdSet) } },
    select: { id: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: AuditRow[] = [];
  let claimsYes = 0;
  let claimsNo = 0;
  let adminApproves = 0;
  let adminRejects = 0;
  const flaggedKeys = new Set<string>();
  const seenRecordIdsForCredit = new Set<number>();
  let totalMinutesCredited = 0;

  for (const a of audits) {
    const record = recordById.get(a.recordId);
    const auditedUser = userById.get(a.userId);
    const performer = userById.get(a.performedById);
    if (!record || !auditedUser || !performer) {
      // Orphan defense — match the API route. Skipped rows do not touch
      // any summary counter, preserving summary.totalAudits === rows.length.
      continue;
    }

    rows.push({
      auditId: a.id,
      action: a.action,
      performedAt: a.performedAt.toISOString(),
      performedById: a.performedById,
      performedByName: performer.name,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      note: a.note,
      recordId: record.id,
      attendanceDate: record.attendanceDate,
      checkOutISO: record.timestamp.toISOString(),
      auditedUserId: auditedUser.id,
      auditedUserName: auditedUser.name,
      otClaimReason: record.otClaimReason,
      otTotalLessThan95: record.otTotalLessThan95,
      currentStatus: record.otApprovalStatus,
      currentMinutesCredited: record.otMinutesCredited ?? 0,
    });

    if (a.action === "CLAIM_YES" || a.action === "CONFIRMED_UNDER_95") {
      claimsYes++;
    } else if (a.action === "CLAIM_NO") {
      claimsNo++;
    } else if (a.action === "ADMIN_APPROVE") {
      adminApproves++;
    } else if (a.action === "ADMIN_REJECT") {
      adminRejects++;
    }

    if (a.toStatus === "AUTO_CREDITED_GRACE" || a.toStatus === "PENDING") {
      flaggedKeys.add(`${auditedUser.id}|${record.attendanceDate}`);
    }

    if (!seenRecordIdsForCredit.has(record.id)) {
      seenRecordIdsForCredit.add(record.id);
      totalMinutesCredited += record.otMinutesCredited ?? 0;
    }
  }

  const summary: AuditSummary = {
    totalAudits: rows.length,
    claimsYes,
    claimsNo,
    adminApproves,
    adminRejects,
    flaggedDays: flaggedKeys.size,
    totalMinutesCredited,
  };

  return { month, userId, rows, summary };
}

function emptyResponse(month: string, userId: number | null): AuditResponse {
  return {
    month,
    userId,
    rows: [],
    summary: {
      totalAudits: 0,
      claimsYes: 0,
      claimsNo: 0,
      adminApproves: 0,
      adminRejects: 0,
      flaggedDays: 0,
      totalMinutesCredited: 0,
    },
  };
}

