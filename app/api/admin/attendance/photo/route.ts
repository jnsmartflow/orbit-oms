import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "attendance-photos";
const SIGNED_URL_EXPIRY_SEC = 300; // 5 min — short-lived per security spec

// GET /api/admin/attendance/photo?recordId=N
//
// Admin-only. Looks up attendance_records.photoPath, generates a 5-min
// signed Supabase URL, returns it as JSON. The bucket is private; URLs
// expire fast so leaked links lose teeth quickly.
export async function GET(req: Request) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const recordIdRaw = url.searchParams.get("recordId");
  const recordId = recordIdRaw ? parseInt(recordIdRaw, 10) : NaN;
  if (!Number.isFinite(recordId)) {
    return NextResponse.json({ error: "Invalid recordId" }, { status: 400 });
  }

  const record = await prisma.attendance_records.findUnique({
    where: { id: recordId },
    select: { photoPath: true },
  });
  if (!record?.photoPath) {
    return NextResponse.json(
      { error: "No photo for this record" },
      { status: 404 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(record.photoPath, SIGNED_URL_EXPIRY_SEC);
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create signed URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
