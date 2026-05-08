import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) redirect("/login");

  // Fresh DB reads — defense in depth so a stale JWT can't trap a user
  // on this page if they've already consented elsewhere (cross-tab,
  // cross-device, or after a version bump that's already been answered).
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

  if (userVersion === currentVersion) {
    redirect("/attendance");
  }

  return <ConsentForm consentVersion={currentVersion} />;
}
