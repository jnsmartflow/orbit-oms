import { prisma } from "@/lib/prisma";
import {
  OtPendingTable,
  type PendingRow,
} from "@/components/admin/attendance/ot-pending-table";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";

export const dynamic = "force-dynamic";

// Admin gating already enforced by app/(ops)/layout.tsx
// (admin | ops_admin) — same delegation pattern as the dashboard page.

export default async function OtPendingPage() {
  const rows = await loadPendingRows();
  return <OtPendingTable initialRows={rows} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Data loading — mirrors GET /api/admin/attendance/ot-pending so the SSR
// payload matches what the client refetch would produce. Sequential awaits
// per CLAUDE_CORE §3 (no $transaction).
// ─────────────────────────────────────────────────────────────────────────

async function loadPendingRows(): Promise<PendingRow[]> {
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

  if (pendingRecords.length === 0) return [];

  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { otTriggerTime: true },
  });
  if (!settings) return [];
  const triggerMin = parseTimeToMin(settings.otTriggerTime);

  // Array.from() around Set per CLAUDE_CORE §3 (target < ES2015).
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

  const out: PendingRow[] = [];
  for (const r of pendingRecords) {
    const user = userById.get(r.userId);
    if (!user) continue; // orphan defense — same as the API route
    const summary = summaryByPair.get(`${r.userId}|${r.attendanceDate}`);
    const otMinutesRaw = Math.max(
      0,
      istMinutesSinceMidnight(r.timestamp) - triggerMin,
    );
    const userRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
    out.push({
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
  return out;
}

