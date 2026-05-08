import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";
import { shiftCalendarDate } from "@/lib/attendance/format";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

interface RolloverError {
  userId: number;
  message: string;
}

// GET /api/cron/attendance-rollover
//
// Vercel Cron schedule: "35 18 * * *" UTC = 00:05 IST daily.
//
// For the calendar day that just ended in IST:
//   1. Active non-exempt users with no summary AND no records → ABSENT
//   2. Existing INCOMPLETE summary → flag hasMissingCheckout (status stays)
//   3. Records but no summary (anomaly — P6 check-in always creates
//      summary) → SKIP. Surfaces in P9 dashboard for admin review.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Defensive yesterdayIST: anchor on (now + 1 hour) to absorb any cron
  // jitter within ±60 minutes (early or late). IST has no DST so the
  // calendar arithmetic is stable year-round.
  const now = new Date();
  const ref = new Date(now.getTime() + 60 * 60 * 1000);
  const todayIST = istDateString(ref);
  const yesterdayIST = shiftCalendarDate(todayIST, 1);

  try {
    // Sequential awaits — never $transaction (Vercel pooler timeout rule).
    const users = await prisma.users.findMany({
      where: { isActive: true, attendanceExempt: false },
      select: { id: true },
    });

    const existingSummaries = await prisma.attendance_summary.findMany({
      where: { attendanceDate: yesterdayIST },
      select: { id: true, userId: true, status: true },
    });
    const summaryByUser = new Map(existingSummaries.map((s) => [s.userId, s]));

    const recordedUsers = await prisma.attendance_records.findMany({
      where: { attendanceDate: yesterdayIST },
      distinct: ["userId"],
      select: { userId: true },
    });
    const usersWithRecords = new Set(recordedUsers.map((r) => r.userId));

    let absentInserted = 0;
    let incompleteFlagged = 0;
    let skippedAnomalies = 0;
    const errors: RolloverError[] = [];

    for (const user of users) {
      try {
        const existing = summaryByUser.get(user.id);
        if (!existing) {
          if (usersWithRecords.has(user.id)) {
            skippedAnomalies++;
            continue;
          }
          await prisma.attendance_summary.create({
            data: {
              userId: user.id,
              attendanceDate: yesterdayIST,
              status: "ABSENT",
            },
          });
          absentInserted++;
        } else if (existing.status === "INCOMPLETE") {
          await prisma.attendance_summary.update({
            where: { id: existing.id },
            data: { hasMissingCheckout: true },
          });
          incompleteFlagged++;
        }
        // Other existing statuses (PRESENT/LATE/HALF_DAY/HOLIDAY/ON_LEAVE/
        // ABSENT) → noop. Already finalised.
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[attendance-rollover] user ${user.id} failed: ${message}`,
        );
        errors.push({ userId: user.id, message });
      }
    }

    return NextResponse.json({
      ok: true,
      targetDate: yesterdayIST,
      userCount: users.length,
      absentInserted,
      incompleteFlagged,
      skippedAnomalies,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[attendance-rollover] top-level failure: ${message}`);
    return NextResponse.json(
      { ok: false, error: message, targetDate: yesterdayIST },
      { status: 500 },
    );
  }
}
