import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { buildSamplingDetail } from "../_lib/detail";

export const dynamic = "force-dynamic";

// ── GET /api/sampling-library/:samplingNo ───────────────────────────────────
export async function GET(
  _req: Request,
  { params }: { params: { samplingNo: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.samplingNo)) {
    return NextResponse.json({ error: "Invalid samplingNo" }, { status: 400 });
  }
  const samplingNo = parseInt(params.samplingNo, 10);

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const detail = await buildSamplingDetail(samplingNo);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[sampling-library/detail]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── PATCH /api/sampling-library/:samplingNo ─────────────────────────────────
// Edits parent metadata. Cannot change samplingNo, tinterType, createdById,
// createdAt. Permission: canEdit.
export async function PATCH(
  req: Request,
  { params }: { params: { samplingNo: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.samplingNo)) {
    return NextResponse.json({ error: "Invalid samplingNo" }, { status: 400 });
  }
  const samplingNo = parseInt(params.samplingNo, 10);

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const data: Prisma.sampling_registerUpdateInput = {};

  if (b.shadeName !== undefined) {
    if (typeof b.shadeName !== "string") {
      return NextResponse.json({ error: "shadeName must be a string", field: "shadeName" }, { status: 400 });
    }
    const trimmed = b.shadeName.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "shadeName must not be empty", field: "shadeName" }, { status: 400 });
    }
    data.shadeName = trimmed;
  }

  if (b.siteId !== undefined) {
    if (b.siteId === null) {
      data.site = { disconnect: true };
    } else if (typeof b.siteId === "number" && Number.isInteger(b.siteId) && b.siteId > 0) {
      data.site = { connect: { id: b.siteId } };
    } else {
      return NextResponse.json({ error: "siteId must be a positive integer or null", field: "siteId" }, { status: 400 });
    }
  }

  if (b.salesOfficerId !== undefined) {
    if (b.salesOfficerId === null) {
      data.salesOfficer = { disconnect: true };
    } else if (typeof b.salesOfficerId === "number" && Number.isInteger(b.salesOfficerId) && b.salesOfficerId > 0) {
      data.salesOfficer = { connect: { id: b.salesOfficerId } };
    } else {
      return NextResponse.json({ error: "salesOfficerId must be a positive integer or null", field: "salesOfficerId" }, { status: 400 });
    }
  }

  if (b.dealerName !== undefined) {
    if (b.dealerName === null) {
      data.dealerName = null;
    } else if (typeof b.dealerName === "string") {
      const t = b.dealerName.trim();
      data.dealerName = t.length > 0 ? t : null;
    } else {
      return NextResponse.json({ error: "dealerName must be string or null", field: "dealerName" }, { status: 400 });
    }
  }

  if (b.notes !== undefined) {
    if (b.notes === null) {
      data.notes = null;
    } else if (typeof b.notes === "string") {
      data.notes = b.notes;
    } else {
      return NextResponse.json({ error: "notes must be string or null", field: "notes" }, { status: 400 });
    }
  }

  if (b.isActive !== undefined) {
    if (typeof b.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean", field: "isActive" }, { status: 400 });
    }
    data.isActive = b.isActive;
  }

  if (b.needsReview !== undefined) {
    if (typeof b.needsReview !== "boolean") {
      return NextResponse.json({ error: "needsReview must be a boolean", field: "needsReview" }, { status: 400 });
    }
    data.needsReview = b.needsReview;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await prisma.sampling_register.update({
      where: { samplingNo },
      data,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[sampling-library/patch]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const detail = await buildSamplingDetail(samplingNo);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
