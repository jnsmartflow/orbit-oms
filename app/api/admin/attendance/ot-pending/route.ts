import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";

export const dynamic = "force-dynamic";

// GET /api/admin/attendance/ot-pending
//
// Admin-only. Returns every CHECK_OUT record currently in
// otApprovalStatus = "PENDING", joined with the user's name + role
// slug and the day's firstCheckInAt + totalMinutesWorked. Ordered
// oldest-first so aging requests surface above fresh ones.
//
// otMinutesRaw is NOT persisted on attendance_records (Prompt 2
// decision — only otMinutesCredited is stored, and it's 0 for
// PENDING rows by design). Admin needs the raw claim amount to
// decide, so we recompute here from record.timestamp and the live
// settings.otTriggerTime using the same formula as ot-logic.ts.
//
// Query approach (sequential awaits, no $transaction):
//   1. Pending records (covered by the (otApprovalStatus,
//      attendanceDate) index from Prompt 1).
//   2. Settings — one row read for otTriggerTime.
//   3. Users — indexed lookup by id IN (...) for the distinct users
//      referenced by the pending set. Kept separate from query 1
//      (rather than as a Prisma include) so an orphan record with a
//      stale userId surfaces as a Map miss in defensive code below,
//      rather than as a runtime error from Prisma's required-relation
//      assertion.
//   4. Summaries — composite-key lookup keyed on (userId,
//      attendanceDate). Single OR-of-pairs query hits the unique
//      index. No N+1.
export async function GET() {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pendingRecords = await prisma.attendance_records.findMany({
    where: { otApprovalStatus: "PENDING" },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      userId: true,
      attendanceDate: true,
      timestamp: true,
      createdAt: true,
      otClaimReason: true,
    },
  });

  if (pendingRecords.length === 0) {
    return NextResponse.json([]);
  }

  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { otTriggerTime: true },
  });
  if (!settings) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }
  const triggerMin = parseTimeToMin(settings.otTriggerTime);

  // Array.from() around Set per CLAUDE_CORE §3 — target < ES2015.
  const userIds = Array.from(new Set(pendingRecords.map((r) => r.userId)));
  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      role: { select: { name: true } },
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const pairs = pendingRecords.map((r) => ({
    userId: r.userId,
    attendanceDate: r.attendanceDate,
  }));
  const summaries = await prisma.attendance_summary.findMany({
    where: { OR: pairs },
    select: {
      userId: true,
      attendanceDate: true,
      firstCheckInAt: true,
      totalMinutesWorked: true,
    },
  });
  const summaryByPair = new Map<string, (typeof summaries)[number]>();
  for (const s of summaries) {
    summaryByPair.set(`${s.userId}|${s.attendanceDate}`, s);
  }

  const response: Array<{
    recordId: number;
    userId: number;
    userName: string;
    userRole: string;
    attendanceDate: string;
    checkInISO: string | null;
    checkOutISO: string;
    totalMinutesWorked: number;
    otMinutesRaw: number;
    otClaimReason: string | null;
    submittedAt: string;
  }> = [];

  for (const r of pendingRecords) {
    // Orphan filter — defense in depth. OrbitOMS schema edits flow
    // through manual SQL (CLAUDE_CORE §3), which can sidestep FK
    // constraints. A pending record with no joined user is logged
    // and skipped rather than 500'ing the whole queue.
    const user = userById.get(r.userId);
    if (!user) {
      console.warn(
        `[ot-pending] orphan record id=${r.id} userId=${r.userId} — user row missing, skipping`,
      );
      continue;
    }
    const summary = summaryByPair.get(`${r.userId}|${r.attendanceDate}`);
    const otMinutesRaw = Math.max(
      0,
      istMinutesSinceMidnight(r.timestamp) - triggerMin,
    );
    // Normalize role.name → slug to match what session.user.role
    // carries elsewhere (lib/auth.ts uses the same recipe).
    const userRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
    response.push({
      recordId: r.id,
      userId: r.userId,
      userName: user.name,
      userRole,
      attendanceDate: r.attendanceDate,
      checkInISO: summary?.firstCheckInAt?.toISOString() ?? null,
      checkOutISO: r.timestamp.toISOString(),
      totalMinutesWorked: summary?.totalMinutesWorked ?? 0,
      otMinutesRaw,
      otClaimReason: r.otClaimReason,
      submittedAt: r.createdAt.toISOString(),
    });
  }

  return NextResponse.json(response);
}
