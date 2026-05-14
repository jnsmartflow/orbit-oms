import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  SettingsForm,
  type SettingsResponse,
} from "@/components/admin/attendance/settings-form";

export const dynamic = "force-dynamic";

// Admin gating already enforced by app/(ops)/layout.tsx
// (admin | ops_admin) — same delegation pattern as the other admin pages.
//
// Settings is intentionally not linked from the workflow switcher or the
// Reports dropdown — direct-URL access only.

export default async function AttendanceSettingsPage() {
  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const row = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  if (!row) redirect("/admin/attendance");

  const otPendingCount = await prisma.attendance_records.count({
    where: { otApprovalStatus: "PENDING" },
  });

  // Mirror buildSettingsResponse() in app/api/admin/attendance/settings/route.ts.
  const initial: SettingsResponse = {
    scope: row.scope,
    roleSlug: row.roleSlug,
    rolloutStage: row.rolloutStage,
    workStartTime: row.workStartTime,
    workEndTime: row.workEndTime,
    lateGraceMinutes: row.lateGraceMinutes,
    halfDayThresholdMinutes: row.halfDayThresholdMinutes,
    checkInWindowStart: row.checkInWindowStart,
    checkInWindowEnd: row.checkInWindowEnd,
    geofenceLat: row.geofenceLat.toNumber(),
    geofenceLng: row.geofenceLng.toNumber(),
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    requirePhoto: row.requirePhoto,
    requireLocation: row.requireLocation,
    photoRetentionDays: row.photoRetentionDays,
    photoMaxWidthPx: row.photoMaxWidthPx,
    photoJpegQuality: row.photoJpegQuality,
    dpdpConsentVersion: row.dpdpConsentVersion,
    depotWorkingMinutes: row.depotWorkingMinutes,
    otTriggerTime: row.otTriggerTime,
    otMonthlyGraceLimit: row.otMonthlyGraceLimit,
    otPromptEnabled: row.otPromptEnabled,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
    updatedByName: row.updatedBy?.name ?? null,
  };

  return <SettingsForm initial={initial} otPendingCount={otPendingCount} />;
}
