import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { buildSamplingDetail } from "../../_lib/detail";

export const dynamic = "force-dynamic";

// ── POST /api/sampling-library/:samplingNo/review ───────────────────────────
// Marks a "needs review" shade as reviewed. Idempotent miss returns 400 if
// already reviewed. Permission: canEdit.
export async function POST(
  req: Request,
  { params }: { params: { samplingNo: string } },
): Promise<NextResponse> {
  // Phase 4: samplingNo is a String key (e.g. "26-0001" or legacy "313584").
  const samplingNo = params.samplingNo.trim();
  if (!/^[A-Za-z0-9-]+$/.test(samplingNo)) {
    return NextResponse.json({ error: "Invalid samplingNo" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Body is optional.
  let resolution: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (b.resolution !== undefined && b.resolution !== null) {
        if (typeof b.resolution !== "string") {
          return NextResponse.json({ error: "resolution must be a string", field: "resolution" }, { status: 400 });
        }
        const t = b.resolution.trim();
        resolution = t.length > 0 ? t : null;
      }
    }
  }

  const existing = await prisma.sampling_register.findUnique({
    where:  { samplingNo },
    select: { needsReview: true, notes: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.needsReview === false) {
    return NextResponse.json({ error: "Already reviewed" }, { status: 400 });
  }

  let nextNotes: string | null = existing.notes;
  if (resolution) {
    const stamp = new Date().toISOString();
    const line  = `[Reviewed ${stamp}] ${resolution}`;
    nextNotes = existing.notes ? `${existing.notes}\n${line}` : line;
  }

  try {
    await prisma.sampling_register.update({
      where: { samplingNo },
      data:  { needsReview: false, notes: nextNotes },
    });
  } catch (err) {
    console.error("[sampling-library/review]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const detail = await buildSamplingDetail(samplingNo);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
