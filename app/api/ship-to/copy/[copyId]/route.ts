import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canViewShipTo } from "@/lib/ship-to/access";
import { SHIP_TO_BUCKET, SHIP_TO_SIGNED_URL_EXPIRY_SEC } from "@/lib/ship-to/copy";

export const dynamic = "force-dynamic";

/**
 * GET /api/ship-to/copy/[copyId] — a 300 s signed URL for ONE dealer / SO
 * challan copy, minted fresh every time (free-text ship-to P1, 2026-10-19;
 * the app/api/mrn/photo/[photoId] pattern). READ-ONLY.
 *
 * 🔴 NEVER STORE A URL. ship_to_copies.storagePath holds the path inside the
 * private bucket; a stored URL expires into a broken link.
 *
 * Refused (404): a removed copy (removedAt set — hidden means hidden, the file
 * staying in storage is not an invitation), and a Floor copy whose bill is
 * soft-removed.
 *
 * Gate: mail_orders canView OR floor canView (lib/ship-to/access.ts).
 */
export async function GET(
  _req: Request,
  { params }: { params: { copyId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewShipTo(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = params.copyId?.trim() ?? "";
  const copyId = Number(raw);
  if (!/^\d+$/.test(raw) || copyId <= 0 || copyId > 2147483647) {
    return NextResponse.json({ error: `Invalid copyId "${params.copyId}" — expected a positive integer` }, { status: 400 });
  }

  const copy = await prisma.ship_to_copies.findUnique({
    where: { id: copyId },
    select: { storagePath: true, contentType: true, removedAt: true, order: { select: { isRemoved: true } } },
  });
  if (!copy || copy.removedAt !== null || copy.order?.isRemoved === true) {
    return NextResponse.json({ error: "Copy not found" }, { status: 404 });
  }

  const { data, error } = await getSupabaseAdmin()
    .storage.from(SHIP_TO_BUCKET)
    .createSignedUrl(copy.storagePath, SHIP_TO_SIGNED_URL_EXPIRY_SEC);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? "Failed to create signed URL" }, { status: 500 });
  }

  return NextResponse.json(
    { signedUrl: data.signedUrl, contentType: copy.contentType, expiresInSec: SHIP_TO_SIGNED_URL_EXPIRY_SEC },
    // Short-lived and per-viewer: a proxy must not serve it after expiry.
    { headers: { "Cache-Control": "no-store" } },
  );
}
