import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";
import {
  addMonths,
  clampMonth,
  getCurrentIstMonth,
  parseMonthParam,
} from "@/lib/attendance/calendar";
import { HistoryCalendar } from "@/components/attendance/history-calendar";

export const dynamic = "force-dynamic";

const MONTHS_BACK_LIMIT = 12;

interface PageProps {
  searchParams: { month?: string | string[] };
}

export default async function HistoryPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) redirect("/login");

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  // Defense-in-depth consent check, mirrors P6/P7 page routes.
  const userRow = await prisma.users.findUnique({
    where: { id: userId },
    select: { attendanceConsentVersion: true },
  });
  const settingsRow = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { dpdpConsentVersion: true },
  });

  const currentVersion = settingsRow?.dpdpConsentVersion ?? "v1.0";
  const userVersion = userRow?.attendanceConsentVersion ?? null;
  if (userVersion !== currentVersion) {
    redirect("/attendance/consent");
  }

  // Parse + clamp `?month=YYYY-MM` from URL. Invalid / out-of-range
  // requests are silently corrected — no 404, no error UI.
  const monthParamRaw = searchParams?.month;
  const monthParam = Array.isArray(monthParamRaw) ? monthParamRaw[0] : monthParamRaw;
  const requestedMonth = parseMonthParam(monthParam);
  const viewedMonth = clampMonth(requestedMonth, MONTHS_BACK_LIMIT);
  const currentMonth = getCurrentIstMonth();
  const minMonth = addMonths(currentMonth, -MONTHS_BACK_LIMIT);

  const monthPrefix = `${viewedMonth.year}-${String(viewedMonth.month).padStart(2, "0")}-`;

  const summaryRows = await prisma.attendance_summary.findMany({
    where: { userId, attendanceDate: { startsWith: monthPrefix } },
    select: {
      attendanceDate: true,
      status: true,
      totalMinutesWorked: true,
      overtimeMinutes: true,
      lateMinutes: true,
      firstCheckInAt: true,
      lastCheckOutAt: true,
      sessionCount: true,
      exceptionReason: true,
    },
  });

  const recordRows = await prisma.attendance_records.findMany({
    where: { userId, attendanceDate: { startsWith: monthPrefix } },
    orderBy: { timestamp: "asc" },
    select: {
      attendanceDate: true,
      type: true,
      timestamp: true,
      locationVerified: true,
      hasNoLocation: true,
    },
  });

  // Serialize Date → ISO for client component contract stability.
  const summaries = summaryRows.map((s) => ({
    attendanceDate: s.attendanceDate,
    status: s.status,
    totalMinutesWorked: s.totalMinutesWorked,
    overtimeMinutes: s.overtimeMinutes,
    lateMinutes: s.lateMinutes,
    firstCheckInISO: s.firstCheckInAt?.toISOString() ?? null,
    lastCheckOutISO: s.lastCheckOutAt?.toISOString() ?? null,
    sessionCount: s.sessionCount,
    exceptionReason: s.exceptionReason,
  }));
  const records = recordRows.map((r) => ({
    attendanceDate: r.attendanceDate,
    type: r.type,
    timestampISO: r.timestamp.toISOString(),
    locationVerified: r.locationVerified,
    hasNoLocation: r.hasNoLocation,
  }));

  const today = istDateString();
  const userName = session.user.name ?? "User";

  return (
    <HistoryCalendar
      key={`${viewedMonth.year}-${viewedMonth.month}`}
      viewedMonth={viewedMonth}
      minMonth={minMonth}
      currentMonth={currentMonth}
      summaries={summaries}
      records={records}
      userName={userName}
      today={today}
    />
  );
}
