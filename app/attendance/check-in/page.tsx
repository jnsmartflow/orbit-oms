import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CheckInFlow } from "@/components/attendance/check-in-flow";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) redirect("/login");

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  // Defense in depth: even though /attendance/page.tsx already redirects
  // unconsented users to /attendance/consent, a direct URL hit on
  // /attendance/check-in must not bypass consent. Fresh DB read.
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
      workEndTime: true,
    },
  });
  if (!settings) redirect("/attendance");

  const currentVersion = settings.dpdpConsentVersion ?? "v1.0";
  const userVersion = userRow?.attendanceConsentVersion ?? null;
  if (userVersion !== currentVersion) {
    redirect("/attendance/consent");
  }

  return (
    <CheckInFlow
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
      workEndTime={settings.workEndTime}
    />
  );
}
