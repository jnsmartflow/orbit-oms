import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/mrn/[mrnId]/photos — every photo on one truck.
 *
 * 🔴 ROWS ONLY. NO SIGNED URLs (design §4.2).
 * Minting a URL per row would mean one Supabase round trip per photo on every
 * list call, to produce links that expire in 300s and that nobody will click
 * more than one or two of. The client lists once, then asks
 * GET /api/mrn/photo/[photoId] for a URL for the photo actually opened.
 *
 * ⚠ AND THE URLs WOULD BE WRONG ANYWAY. A 300s link minted at list time is
 * already stale by the time a supervisor scrolls to it — the failure would look
 * like a broken image rather than an expired link, on the one screen where an
 * image failing to load reads as lost evidence.
 *
 * canView, not canEdit: `operations` holds canView and canEdit but no
 * canDelete, and reading the evidence is not editing it (design §7).
 *
 * ⚠ NOT DATE-FENCED AND NOT PAGINATED. A truck's photo count is bounded by how
 * many issue lines it has — single digits in practice, and the live data has
 * four issue lines across ten MRNs. If that ever changes, paginate here rather
 * than in the caller.
 */
export async function GET(
  _req: Request,
  { params }: { params: { mrnId: string } },
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

  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // isRemoved: false — a soft-removed MRN is gone from every screen (§11 OQ-8),
  // so it 404s here exactly as it does on the detail route. The two cases are
  // not distinguished in the response.
  const mrn = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { id: true },
  });
  if (!mrn) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }

  const photos = await prisma.mrn_photos.findMany({
    where: { mrnId },
    select: {
      id: true,
      kind: true,
      lineId: true,
      bytes: true,
      widthPx: true,
      heightPx: true,
      createdAt: true,
      capturedBy: { select: { name: true } },
    },
    // Capture order. The LR is usually taken at End and the issue photos during
    // the count, so oldest-first reads as the sequence of the unloading.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    mrnId,
    photos: photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      lineId: p.lineId,
      bytes: p.bytes,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      createdAt: p.createdAt,
      capturedByName: p.capturedBy?.name ?? null,
    })),
  });
}
