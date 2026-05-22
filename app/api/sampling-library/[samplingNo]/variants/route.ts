import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { PackCode, Prisma } from "@prisma/client";
import {
  buildPigmentNumbers,
  buildPigmentsResponse,
  isValidPackCode,
  type PigmentCode,
} from "../../_lib/validate";

export const dynamic = "force-dynamic";

// ── Sort whitelist ──────────────────────────────────────────────────────────
const ALLOWED_SORTS = ["lastUsedAt", "usageCount", "createdAt", "isPrimary"] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];

// ── GET /api/sampling-library/:samplingNo/variants ──────────────────────────
export async function GET(
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
  const allowed = await checkAnyPermission(roles, "sampling_library", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sortParam  = searchParams.get("sort")  ?? "";
  const orderParam = (searchParams.get("order") ?? "desc").toLowerCase();
  const sort: SortKey = (ALLOWED_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SortKey)
    : "isPrimary";
  const order: "asc" | "desc" = orderParam === "asc" ? "asc" : "desc";

  // Default sort (isPrimary desc) tiebreaks by usageCount desc so the
  // primary variant is first and the rest fall into most-used-first order.
  const orderBy:
    | Prisma.sampling_recipesOrderByWithRelationInput
    | Prisma.sampling_recipesOrderByWithRelationInput[] =
    sort === "isPrimary"
      ? [{ isPrimary: order }, { usageCount: "desc" }]
      : { [sort]: order };

  try {
    const parent = await prisma.sampling_register.findUnique({
      where:  { samplingNo },
      select: { samplingNo: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await prisma.sampling_recipes.findMany({
      where: { samplingNo },
      orderBy,
    });

    const variants = rows.map((r) => {
      const { pigments, activePigments } = buildPigmentsResponse(
        r as unknown as Record<PigmentCode, Prisma.Decimal | null>,
      );
      return {
        id:          r.id,
        skuCode:     r.skuCode,
        productName: r.productName,
        packCode:    r.packCode,
        tinQty:      r.tinQty.toNumber(),
        pigments,
        activePigments,
        isPrimary:   r.isPrimary,
        usageCount:  r.usageCount,
        firstUsedAt: r.firstUsedAt ? r.firstUsedAt.toISOString() : null,
        lastUsedAt:  r.lastUsedAt  ? r.lastUsedAt.toISOString()  : null,
        createdAt:   r.createdAt.toISOString(),
        updatedAt:   r.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      samplingNo,
      variants,
      total: variants.length,
    });
  } catch (err) {
    console.error("[sampling-library/variants]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST /api/sampling-library/:samplingNo/variants ─────────────────────────
// Create or upsert a variant (unique on samplingNo+skuCode+packCode).
// Permission: canEdit.
export async function POST(
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

  // Verify parent exists.
  const parent = await prisma.sampling_register.findUnique({
    where:  { samplingNo },
    select: { samplingNo: true },
  });
  if (!parent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  if (typeof b.skuCode !== "string" || !b.skuCode.trim()) {
    return NextResponse.json({ error: "skuCode is required", field: "skuCode" }, { status: 400 });
  }
  const skuCode = b.skuCode.trim();

  if (!isValidPackCode(b.packCode)) {
    return NextResponse.json({ error: "packCode is invalid", field: "packCode" }, { status: 400 });
  }
  const packCode: PackCode = b.packCode;

  let productName: string | null = null;
  if (b.productName != null) {
    if (typeof b.productName !== "string") {
      return NextResponse.json({ error: "productName must be string or null", field: "productName" }, { status: 400 });
    }
    const t = b.productName.trim();
    productName = t.length > 0 ? t : null;
  }

  const tinQty = typeof b.tinQty === "number" && Number.isFinite(b.tinQty) && b.tinQty >= 0
    ? b.tinQty
    : 0;

  const pigments = buildPigmentNumbers(b.pigments);
  const isPrimary = typeof b.isPrimary === "boolean" ? b.isPrimary : false;

  // Optional usage counters (rarely supplied by clients).
  let usageCount: number | undefined;
  if (b.usageCount !== undefined) {
    if (typeof b.usageCount !== "number" || !Number.isInteger(b.usageCount) || b.usageCount < 0) {
      return NextResponse.json({ error: "usageCount must be a non-negative integer", field: "usageCount" }, { status: 400 });
    }
    usageCount = b.usageCount;
  }

  function parseIsoOrNull(v: unknown): Date | null | "invalid" {
    if (v === null) return null;
    if (typeof v !== "string") return "invalid";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "invalid";
    return d;
  }

  let firstUsedAt: Date | null | undefined;
  if (b.firstUsedAt !== undefined) {
    const r = parseIsoOrNull(b.firstUsedAt);
    if (r === "invalid") {
      return NextResponse.json({ error: "firstUsedAt must be an ISO date string or null", field: "firstUsedAt" }, { status: 400 });
    }
    firstUsedAt = r;
  }

  let lastUsedAt: Date | null | undefined;
  if (b.lastUsedAt !== undefined) {
    const r = parseIsoOrNull(b.lastUsedAt);
    if (r === "invalid") {
      return NextResponse.json({ error: "lastUsedAt must be an ISO date string or null", field: "lastUsedAt" }, { status: 400 });
    }
    lastUsedAt = r;
  }

  // If marking primary, clear all other variants' isPrimary first so the new
  // one wins. Sequential awaits per CORE §3.
  if (isPrimary) {
    try {
      await prisma.sampling_recipes.updateMany({
        where: { samplingNo, isPrimary: true },
        data:  { isPrimary: false },
      });
    } catch (err) {
      console.error("[sampling-library/variants/clear-primary]", err);
      return NextResponse.json({ error: "Failed to clear existing primary" }, { status: 500 });
    }
  }

  // Try create; on unique-constraint collision, update the existing row.
  const baseData = {
    skuCode,
    productName,
    packCode,
    tinQty,
    ...pigments,
    isPrimary,
    ...(usageCount  !== undefined && { usageCount }),
    ...(firstUsedAt !== undefined && { firstUsedAt }),
    ...(lastUsedAt  !== undefined && { lastUsedAt }),
  };

  try {
    const created = await prisma.sampling_recipes.create({
      data: { ...baseData, samplingNo },
    });
    const { pigments: outPigments, activePigments } = buildPigmentsResponse(
      created as unknown as Record<PigmentCode, Prisma.Decimal | null>,
    );
    return NextResponse.json({
      id:          created.id,
      skuCode:     created.skuCode,
      productName: created.productName,
      packCode:    created.packCode,
      tinQty:      created.tinQty.toNumber(),
      pigments:    outPigments,
      activePigments,
      isPrimary:   created.isPrimary,
      usageCount:  created.usageCount,
      firstUsedAt: created.firstUsedAt ? created.firstUsedAt.toISOString() : null,
      lastUsedAt:  created.lastUsedAt  ? created.lastUsedAt.toISOString()  : null,
      createdAt:   created.createdAt.toISOString(),
      updatedAt:   created.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Conflict on @@unique([samplingNo, skuCode, packCode]) → upsert path.
      try {
        const updated = await prisma.sampling_recipes.update({
          where: {
            samplingNo_skuCode_packCode: { samplingNo, skuCode, packCode },
          },
          data: baseData,
        });
        const { pigments: outPigments, activePigments } = buildPigmentsResponse(
          updated as unknown as Record<PigmentCode, Prisma.Decimal | null>,
        );
        return NextResponse.json({
          id:          updated.id,
          skuCode:     updated.skuCode,
          productName: updated.productName,
          packCode:    updated.packCode,
          tinQty:      updated.tinQty.toNumber(),
          pigments:    outPigments,
          activePigments,
          isPrimary:   updated.isPrimary,
          usageCount:  updated.usageCount,
          firstUsedAt: updated.firstUsedAt ? updated.firstUsedAt.toISOString() : null,
          lastUsedAt:  updated.lastUsedAt  ? updated.lastUsedAt.toISOString()  : null,
          createdAt:   updated.createdAt.toISOString(),
          updatedAt:   updated.updatedAt.toISOString(),
        });
      } catch (err2) {
        console.error("[sampling-library/variants/update-on-conflict]", err2);
        const msg = err2 instanceof Error ? err2.message : "unknown error";
        return NextResponse.json({
          error: `Variant conflict detected but update failed: ${msg}.`,
        }, { status: 500 });
      }
    }
    console.error("[sampling-library/variants/create]", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({
      error: isPrimary
        ? `Primary flag was cleared on existing variants, but the new variant failed to save: ${msg}. Re-mark a primary manually.`
        : `Failed to save variant: ${msg}.`,
    }, { status: 500 });
  }
}

