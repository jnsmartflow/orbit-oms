import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { BUCKET, SIGNED_URL_EXPIRY_SEC } from "@/lib/mrn/photo";

export const dynamic = "force-dynamic";

/**
 * One MRN photo, by its own id.
 *
 *   GET    /api/mrn/photo/[photoId]  — mint a short-lived signed URL
 *   DELETE /api/mrn/photo/[photoId]  — remove the photo
 *
 * ⚠ THE ROUTE IS KEYED ON THE PHOTO, NOT ON THE MRN, and that is deliberate:
 * a photo id is globally unique, so the caller does not have to carry the mrnId
 * around to open or delete one. The MRN is loaded from the row (`photo.mrn`)
 * because the DELETE guard needs its status.
 *
 * ⚠ THIS STATIC `photo` SEGMENT SITS BESIDE THE DYNAMIC `[mrnId]`.
 * Next resolves static before dynamic, so /api/mrn/photo/7 reaches this file
 * and never app/api/mrn/[mrnId]/route.ts. /api/mrn/photo with no id DOES fall
 * through to [mrnId], whose `^\d+$` check 400s it. Safe, but walk all four
 * photo routes before renaming any segment — see the map in
 * app/api/mrn/[mrnId]/photo/route.ts.
 */

/** Shared path-segment validation. Same shape as every other MRN route. */
function parsePhotoId(raw: string | undefined): number | null {
  const t = raw?.trim() ?? "";
  const n = Number(t);
  if (!/^\d+$/.test(t) || n <= 0 || n > 2147483647) return null;
  return n;
}

/**
 * GET — a signed URL, minted fresh, every time.
 *
 * 🔴 NEVER STORE A URL (design §4.2). `mrn_photos.storagePath` holds the path
 * INSIDE the bucket and nothing else. A stored URL expires and becomes a broken
 * image with no way back to the object; a stored path is permanent and a URL is
 * one call away. This is the same arrangement as the attendance viewer
 * (app/api/admin/attendance/photo/route.ts:44) and the expiry matches it.
 *
 * canView — reading the evidence is not editing it (design §7).
 */
export async function GET(
  _req: Request,
  { params }: { params: { photoId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const photoId = parsePhotoId(params.photoId);
  if (photoId === null) {
    return NextResponse.json(
      { error: `Invalid photoId "${params.photoId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // isRemoved on the PARENT — a photo on a soft-removed MRN is as gone as the
  // MRN is (§11 OQ-8). Without this, a stale id would still hand out a live
  // signed URL for a truck that has disappeared from every screen.
  const photo = await prisma.mrn_photos.findFirst({
    where: { id: photoId, mrn: { isRemoved: false } },
    select: { storagePath: true },
  });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(photo.storagePath, SIGNED_URL_EXPIRY_SEC);
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create signed URL" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { signedUrl: data.signedUrl, expiresInSec: SIGNED_URL_EXPIRY_SEC },
    // The URL is short-lived and per-viewer. A proxy holding one and serving it
    // after expiry would produce a broken image nobody could explain.
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * DELETE — remove a photo (design §5.4).
 *
 * ── TWO DIFFERENT PERMISSIONS, CHOSEN BY THE MRN's STATUS ───────────────────
 *   status === 'checking'  → the user who CAPTURED it may delete it. This is
 *                            the retake path: he took a blurred photo thirty
 *                            seconds ago and wants it gone. Anyone else needs
 *                            canDelete.
 *   'done' / 'closed'      → canDelete ONLY (billing_operator, admin). The
 *                            unloading is over and the photo is part of a
 *                            supplier-facing document; the supervisor's
 *                            retake window has closed with it.
 *   'open'                 → unreachable. Photos cannot exist on an open MRN
 *                            (the upload route 409s), so no rule is needed and
 *                            none is written — the canDelete branch covers it.
 *
 * ⚠ THERE IS NO RETAKE ENDPOINT AND THERE MUST NOT BE ONE. A retake is delete
 * then capture. `mrn_photos` has no `updatedAt` precisely because a photo is
 * immutable (design §4.1) — an edit path would need one and would make the
 * row's createdAt a lie about the image it points at.
 *
 * ── ROW FIRST, THEN OBJECT (design §5.4) ────────────────────────────────────
 * The opposite order of the upload, and for a symmetric reason. An orphaned
 * OBJECT is a storage cost nobody sees. An orphaned ROW is a broken image on a
 * supplier-facing screen. If the object delete fails after the row is gone we
 * have paid the cheaper price; if the row delete failed after the object was
 * gone we would have paid the dearer one.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { photoId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewerId = Number(session.user.id);
  if (!Number.isInteger(viewerId) || viewerId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const photoId = parsePhotoId(params.photoId);
  if (photoId === null) {
    return NextResponse.json(
      { error: `Invalid photoId "${params.photoId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // The row, its owner and its truck's status in ONE read — the permission
  // decision below needs all three and none of them can be assumed.
  const photo = await prisma.mrn_photos.findFirst({
    where: { id: photoId, mrn: { isRemoved: false } },
    select: {
      id: true,
      storagePath: true,
      capturedById: true,
      mrn: { select: { status: true } },
    },
  });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const isAdmin = roles.includes("admin");
  const canDelete = isAdmin || (await checkAnyPermission(roles, "mrn", "canDelete"));

  // 🔴 THE OWNER EXCEPTION IS NARROW ON PURPOSE: it is 'checking' AND the
  // capturer, never one or the other. A supervisor may not delete a colleague's
  // photo (Checking is deliberately not scoped to one viewer — design §11 OQ-6,
  // so two supervisors do share a truck), and nobody's retake window survives
  // End unloading.
  const isOwnDuringChecking =
    photo.mrn.status === "checking" && photo.capturedById === viewerId;

  if (!canDelete && !isOwnDuringChecking) {
    return NextResponse.json(
      {
        error:
          photo.mrn.status === "checking"
            ? "You can only delete a photo you took yourself."
            : "This MRN is finished — only billing can remove its photos now.",
      },
      { status: 403 },
    );
  }

  // ── Row first ──────────────────────────────────────────────────────────────
  await prisma.mrn_photos.delete({ where: { id: photoId } });

  // ── Then the object. Its failure is LOGGED, NOT RETURNED ───────────────────
  // The row is already gone, so the operator's action succeeded and the screen
  // is correct. Returning a 500 here would tell them it failed and invite a
  // retry that can only 404. The leaked object is a cost, and it is recorded
  // below with its path so it can be swept by hand if it ever matters.
  //
  // ⚠ There is deliberately NO cron to clean this up (design §4.4 — retention
  // was ruled out by the owner). Do not add one, and do not widen
  // app/api/cron/attendance-purge to see this bucket.
  const supabase = getSupabaseAdmin();
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([photo.storagePath]);
  if (removeError) {
    console.error(
      `[mrn/photo] ORPHANED OBJECT — row ${photoId} deleted but the storage object was not. Path: ${photo.storagePath}. Error: ${removeError.message}`,
    );
  }

  return NextResponse.json({ ok: true, id: photoId });
}
