import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UniversalHeader } from "@/components/universal-header";
import { AdminSubNav } from "@/components/admin/attendance/admin-sub-nav";
import {
  SettingsForm,
  type SettingsResponse,
} from "@/components/admin/attendance/settings-form";

export const dynamic = "force-dynamic";

// Admin gating already enforced by app/(ops)/layout.tsx
// (admin | ops_admin) — same delegation pattern as the other admin pages.

const istLastUpdatedFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  // Decimal → number, Date → ISO so the client form can hold every field
  // as a plain JS primitive without a Decimal dependency.
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

  const subtitle = `Last updated ${istLastUpdatedFormatter.format(row.updatedAt)} IST by ${
    initial.updatedByName ?? "system"
  }`;

  return (
    <div className="min-w-[800px]">
      <UniversalHeader
        title={
          <span className="flex flex-col leading-tight">
            <span>Attendance Settings</span>
            <span className="text-[11px] font-normal text-gray-400 tabular-nums">
              {subtitle}
            </span>
          </span>
        }
      />
      <AdminSubNav active="settings" otPendingCount={otPendingCount} />
      <div className="max-w-3xl mx-auto p-6 pb-24">
        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}
