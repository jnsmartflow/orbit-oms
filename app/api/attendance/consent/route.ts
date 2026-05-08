import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/attendance/consent
// Records the current user's consent at the live dpdpConsentVersion from
// attendance_settings (GLOBAL row). Idempotent — re-posting just bumps
// attendanceConsentAt. No request body.
export async function POST() {
  const session = await auth();
  const userIdRaw = session?.user?.id;
  if (!userIdRaw) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const settingsRow = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { dpdpConsentVersion: true },
  });
  const consentVersion = settingsRow?.dpdpConsentVersion ?? "v1.0";

  await prisma.users.update({
    where: { id: userId },
    data: {
      attendanceConsentAt: new Date(),
      attendanceConsentVersion: consentVersion,
    },
  });

  return NextResponse.json({ ok: true, consentVersion });
}
