import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";

export const dynamic = "force-dynamic";

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const MIN_YEAR = 2024;
const MAX_YEAR = 2099;
const MAX_MONTHS_BACK = 24;

// GET /api/admin/attendance/ot-audit?month=YYYY-MM&userId=N
//
// Admin-only. Read-only audit-log report for the "monthly review"
// flow promised by the trust+flag model: who claimed OT when, with
// what reason, what status it landed in, whether admin intervened,
// and what admin did. Filterable by month (required-or-defaults-to-
// current-IST-month) and optionally by user.
//
// Filter semantics (Option 2 from the design):
//   - We filter by the underlying record.attendanceDate, NOT by
//     audit.performedAt. The admin's mental model is "show me May's
//     OT activity" = May attendance days, regardless of when admin
//     physically acted on the record. An admin approval done on
//     June 3 of a record from May 28 belongs in the May report.
//     This also aligns with the grace counter, which is anchored
//     to the attendance month.
//
// Query approach (sequential awaits, no $transaction):
//   1. audit rows with a relation-filter on record.attendanceDate
//      (and optionally record.userId). Inner-join semantics mean
//      orphan audits with a stale recordId are filtered out
//      implicitly — they couldn't satisfy the relation anyway.
//   2. records by id IN (set of recordIds from query 1) — selected
//      separately so the per-row defense below can null-check via
//      a Map miss rather than relying on Prisma include resolution.
//   3. users by id IN (audited + performer userIds) — same pattern.
//
// Defense in depth: any audit row whose joined record / audited
// user / performer is missing from its Map (manual SQL bypassed
// CASCADE FKs, etc.) is logged and skipped — it does NOT count in
// any summary counter, so summary.totalAudits === rows.length holds.
export async function GET(req: Request) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN, ROLES.OPS_ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);

  // ── Validate `month` ────────────────────────────────────────────────────
  const monthParam = url.searchParams.get("month");
  const currentMonth = istDateString().slice(0, 7);
  const month = monthParam ?? currentMonth;

  if (!MONTH_REGEX.test(month)) {
    return NextResponse.json(
      { error: "month must be YYYY-MM" },
      { status: 400 },
    );
  }
  const [reqY, reqM] = month.split("-").map(Number);
  if (reqY < MIN_YEAR || reqY > MAX_YEAR || reqM < 1 || reqM > 12) {
    return NextResponse.json(
      { error: "month must be YYYY-MM" },
      { status: 400 },
    );
  }
  // Future bound — symmetric with the past bound below. Stops typo
  // inputs ("2027-05" for what should be "2026-05") from silently
  // returning an empty report.
  if (month > currentMonth) {
    return NextResponse.json(
      { error: "month must not be in the future" },
      { status: 400 },
    );
  }
  // Past bound — practical ceiling on scan size. 24 months is the
  // monthly-review use case window.
  const [curY, curM] = currentMonth.split("-").map(Number);
  const reqIndex = reqY * 12 + reqM;
  const minIndex = curY * 12 + curM - MAX_MONTHS_BACK;
  if (reqIndex < minIndex) {
    return NextResponse.json(
      { error: `month must be within the last ${MAX_MONTHS_BACK} months` },
      { status: 400 },
    );
  }

  // ── Validate optional `userId` ──────────────────────────────────────────
  const userIdRaw = url.searchParams.get("userId");
  let userId: number | null = null;
  if (userIdRaw !== null && userIdRaw !== "") {
    const parsed = parseInt(userIdRaw, 10);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: "userId must be a number" },
        { status: 400 },
      );
    }
    userId = parsed;
    // Existence check — inactive users are still allowed (their
    // past OT claims are legitimate audit subjects). Only "no such
    // row at all" yields 404.
    const userRow = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  // ── Compute month range strings ─────────────────────────────────────────
  // YYYY-MM-DD strings sort lexicographically = chronologically, so a
  // [gte, lt) range filter on the indexed attendanceDate column hits
  // the existing index cleanly.
  const monthStart = `${month}-01`;
  const nextY = reqM === 12 ? reqY + 1 : reqY;
  const nextM = reqM === 12 ? 1 : reqM + 1;
  const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  // ── Audit rows (sequential awaits — never $transaction) ─────────────────
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
    return NextResponse.json(emptyResponse(month, userId));
  }

  // ── Records lookup ──────────────────────────────────────────────────────
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

  // ── Users lookup (audited users + performers, deduped) ──────────────────
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

  // ── Build rows + summary in one walk ────────────────────────────────────
  type AuditRow = {
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
  };
  const rows: AuditRow[] = [];
  let claimsYes = 0;
  let claimsNo = 0;
  let adminApproves = 0;
  let adminRejects = 0;
  // Distinct (auditedUserId, attendanceDate) pairs whose toStatus was
  // a flagged state. Keyed explicitly on the audited user (not the
  // performer) so a single attendance day across multiple users
  // contributes its full count, and the key can't be confused with
  // a performer-based lookup at read time.
  const flaggedKeys = new Set<string>();
  // Distinct recordIds we've already added to totalMinutesCredited.
  // A record commonly has multiple audit rows (claim + admin action);
  // summing credit across every audit row would double-count.
  const seenRecordIdsForCredit = new Set<number>();
  let totalMinutesCredited = 0;

  for (const a of audits) {
    const record = recordById.get(a.recordId);
    const auditedUser = userById.get(a.userId);
    const performer = userById.get(a.performedById);
    if (!record || !auditedUser || !performer) {
      // Orphan defense in depth. Under the schema's CASCADE/RESTRICT
      // FKs (Prompt 1) this branch is unreachable, but the depot
      // edits via manual SQL — log and skip rather than 500'ing the
      // report. Skipped rows do NOT touch any summary counter, so
      // summary.totalAudits === rows.length is always true.
      console.warn(
        `[ot-audit] orphan audit id=${a.id} recordId=${a.recordId} userId=${a.userId} performedById=${a.performedById} — skipping`,
      );
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

    // CLAIM_YES + CONFIRMED_UNDER_95 both mean "user said yes" — the
    // distinction (full day vs short-day acknowledgement) is on the
    // row; the summary top-line just wants the yes-claim count.
    if (a.action === "CLAIM_YES" || a.action === "CONFIRMED_UNDER_95") {
      claimsYes++;
    } else if (a.action === "CLAIM_NO") {
      claimsNo++;
    } else if (a.action === "ADMIN_APPROVE") {
      adminApproves++;
    } else if (a.action === "ADMIN_REJECT") {
      adminRejects++;
    }
    // (ADMIN_OVERRIDE is in the schema's enum but no endpoint emits
    //  it yet — counted under no bucket, but still appears in rows.)

    if (a.toStatus === "AUTO_CREDITED_GRACE" || a.toStatus === "PENDING") {
      flaggedKeys.add(`${auditedUser.id}|${record.attendanceDate}`);
    }

    if (!seenRecordIdsForCredit.has(record.id)) {
      seenRecordIdsForCredit.add(record.id);
      totalMinutesCredited += record.otMinutesCredited ?? 0;
    }
  }

  return NextResponse.json({
    month,
    userId,
    rows,
    summary: {
      totalAudits: rows.length,
      claimsYes,
      claimsNo,
      adminApproves,
      adminRejects,
      flaggedDays: flaggedKeys.size,
      totalMinutesCredited,
    },
  });
}

function emptyResponse(month: string, userId: number | null) {
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
