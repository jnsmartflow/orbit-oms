import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CheckOutFlow } from "@/components/attendance/check-out-flow";
import { istDateString } from "@/lib/attendance/date";

export const dynamic = "force-dynamic";

export default async function CheckOutPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) redirect("/login");

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  // Defense in depth: consent + open-session checks before mounting the
  // camera. A direct URL hit on /attendance/check-out without an open
  // session redirects to /attendance, where the home screen handles the
  // not-checked-in UX naturally.
  const userRow = await prisma.users.findUnique({
    where: { id: userId },
    select: { attendanceConsentVersion: true },
  });
  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: {
      dpdpConsentVersion: true,
      geofenceLat: true,
      geofenceLng: true,
      geofenceRadiusMeters: true,
      photoMaxWidthPx: true,
      photoJpegQuality: true,
      workStartTime: true,
      workEndTime: true,
      otTriggerTime: true,
      otPromptEnabled: true,
    },
  });
  if (!settings) redirect("/attendance");

  const currentVersion = settings.dpdpConsentVersion ?? "v1.0";
  const userVersion = userRow?.attendanceConsentVersion ?? null;
  if (userVersion !== currentVersion) {
    redirect("/attendance/consent");
  }

  // Open-session check — latest record today must be a CHECK_IN.
  // Same query the API uses; UI normally only routes here from the
  // home screen's WORKING-state CTA, but defense in depth.
  const today = istDateString();
  const lastRecord = await prisma.attendance_records.findFirst({
    where: { userId, attendanceDate: today },
    orderBy: { timestamp: "desc" },
    select: { type: true },
  });
  if (!lastRecord || lastRecord.type !== "CHECK_IN") {
    redirect("/attendance");
  }

  return (
    <CheckOutFlow
      userName={session.user.name ?? "User"}
      userRole={session.user.role ?? ""}
      geofence={{
        lat: settings.geofenceLat.toNumber(),
        lng: settings.geofenceLng.toNumber(),
        radiusMeters: settings.geofenceRadiusMeters,
      }}
      photo={{
        maxWidth: settings.photoMaxWidthPx,
        quality: settings.photoJpegQuality,
      }}
      workStartTime={settings.workStartTime}
      workEndTime={settings.workEndTime}
      otTriggerTime={settings.otTriggerTime}
      otPromptEnabled={settings.otPromptEnabled}
      today={today}
    />
  );
}
