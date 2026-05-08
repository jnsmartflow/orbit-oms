import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";
import { deriveAttendanceState } from "@/lib/attendance/state";
import { shiftCalendarDate } from "@/lib/attendance/format";
import { AttendanceHome, type DaySummary } from "@/components/attendance/attendance-home";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) redirect("/login");

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  // Page reads the JWT-stale-safe values from DB directly so a stale
  // attendanceConsentVersion claim can't trap a freshly-consented user.
  const userRow = await prisma.users.findUnique({
    where: { id: userId },
    select: { attendanceConsentVersion: true },
  });
  const settingsRow = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: {
      dpdpConsentVersion: true,
      workStartTime: true,
      workEndTime: true,
    },
  });

  const currentVersion = settingsRow?.dpdpConsentVersion ?? "v1.0";
  const userVersion = userRow?.attendanceConsentVersion ?? null;

  if (userVersion !== currentVersion) {
    redirect("/attendance/consent");
  }

  const today = istDateString();

  // 7-day window of past calendar dates (today excluded — today's
  // summary is fetched separately and feeds the WORKING/COMPLETE UI).
  const pastWeekDates: string[] = [];
  for (let i = 1; i <= 7; i++) {
    pastWeekDates.push(shiftCalendarDate(today, i));
  }

  const todayRecords = await prisma.attendance_records.findMany({
    where: { userId, attendanceDate: today },
    orderBy: { timestamp: "asc" },
    select: { type: true, timestamp: true },
  });

  const summaryWindow = await prisma.attendance_summary.findMany({
    where: { userId, attendanceDate: { in: [today, ...pastWeekDates] } },
    orderBy: { attendanceDate: "desc" },
    select: {
      attendanceDate: true,
      firstCheckInAt: true,
      lastCheckOutAt: true,
      totalMinutesWorked: true,
      status: true,
    },
  });

  const state = deriveAttendanceState(todayRecords);

  const todaySummaryRow = summaryWindow.find((s) => s.attendanceDate === today) ?? null;
  const todaySummary: DaySummary | null = todaySummaryRow
    ? {
        attendanceDate: todaySummaryRow.attendanceDate,
        firstCheckInISO: todaySummaryRow.firstCheckInAt?.toISOString() ?? null,
        lastCheckOutISO: todaySummaryRow.lastCheckOutAt?.toISOString() ?? null,
        totalMinutesWorked: todaySummaryRow.totalMinutesWorked,
        status: todaySummaryRow.status,
      }
    : null;

  const weekSummaries: DaySummary[] = summaryWindow
    .filter((s) => s.attendanceDate !== today)
    .map((s) => ({
      attendanceDate: s.attendanceDate,
      firstCheckInISO: s.firstCheckInAt?.toISOString() ?? null,
      lastCheckOutISO: s.lastCheckOutAt?.toISOString() ?? null,
      totalMinutesWorked: s.totalMinutesWorked,
      status: s.status,
    }));

  const settings = {
    workStartTime: settingsRow?.workStartTime ?? "09:30",
    workEndTime: settingsRow?.workEndTime ?? "19:00",
  };

  return (
    <AttendanceHome
      state={state}
      todaySummary={todaySummary}
      weekSummaries={weekSummaries}
      settings={settings}
      userName={session.user.name ?? "User"}
      today={today}
    />
  );
}
