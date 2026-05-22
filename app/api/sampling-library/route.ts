import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { PackCode, Prisma, TinterType } from "@prisma/client";
import {
  buildPigmentNumbers,
  isValidPackCode,
  isValidTinterType,
} from "./_lib/validate";

export const dynamic = "force-dynamic";

// ── Sort whitelist ──────────────────────────────────────────────────────────
const ALLOWED_SORTS = ["samplingNo", "shadeName", "createdAt", "updatedAt"] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE     = 200;

function parseBool(v: string | null): boolean | undefined {
  if (v === "true")  return true;
  if (v === "false") return false;
  return undefined;
}

function parsePositiveInt(v: string | null): number | undefined {
  if (!v) return undefined;
  if (!/^\d+$/.test(v)) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ── GET /api/sampling-library ───────────────────────────────────────────────
export async function GET(req: Request): Promise<NextResponse> {
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

  // ── Pagination ────────────────────────────────────────────────────────────
  const page     = parsePositiveInt(searchParams.get("page")) ?? 1;
  const reqSize  = parsePositiveInt(searchParams.get("pageSize")) ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(reqSize, MAX_PAGE_SIZE);

  // ── Sort + order ──────────────────────────────────────────────────────────
  const sortParam  = searchParams.get("sort")  ?? "";
  const orderParam = (searchParams.get("order") ?? "asc").toLowerCase();
  const sort: SortKey = (ALLOWED_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SortKey)
    : "samplingNo";
  const order: "asc" | "desc" = orderParam === "desc" ? "desc" : "asc";

  // ── tinterType ────────────────────────────────────────────────────────────
  const tinterTypeRaw = searchParams.get("tinterType")?.trim();
  if (tinterTypeRaw && !(tinterTypeRaw in TinterType)) {
    return NextResponse.json({ error: "Invalid tinterType" }, { status: 400 });
  }
  const tinterType = tinterTypeRaw ? (tinterTypeRaw as TinterType) : undefined;

  // ── Flag filters ──────────────────────────────────────────────────────────
  const isActive    = parseBool(searchParams.get("isActive"));
  const needsReview = parseBool(searchParams.get("needsReview"));

  // ── ID filters ────────────────────────────────────────────────────────────
  const siteId          = parsePositiveInt(searchParams.get("siteId"));
  const salesOfficerId  = parsePositiveInt(searchParams.get("salesOfficerId"));

  // ── Search ────────────────────────────────────────────────────────────────
  const search = searchParams.get("search")?.trim() ?? "";
  const isNumericSearch = search.length > 0 && /^\d+$/.test(search);

  // ── Build dynamic WHERE clause via Prisma.sql fragments ───────────────────
  // Every user-supplied value is passed as a ${param} so Prisma binds it; no
  // string concatenation of input. The `sort` / `order` query params parsed
  // above are deliberately ignored — the SQL ORDER BY below is global by
  // lastUsedAt DESC NULLS LAST (with samplingNo DESC as tiebreaker) so the
  // ordering is stable across pagination boundaries.
  void sort;
  void order;
  const conds: Prisma.Sql[] = [];
  if (tinterType !== undefined) {
    conds.push(Prisma.sql`sr."tinterType" = ${tinterType}::"TinterType"`);
  }
  if (isActive !== undefined) {
    conds.push(Prisma.sql`sr."isActive" = ${isActive}`);
  }
  if (needsReview !== undefined) {
    conds.push(Prisma.sql`sr."needsReview" = ${needsReview}`);
  }
  if (siteId !== undefined) {
    conds.push(Prisma.sql`sr."siteId" = ${siteId}`);
  }
  if (salesOfficerId !== undefined) {
    conds.push(Prisma.sql`sr."salesOfficerId" = ${salesOfficerId}`);
  }
  if (search) {
    const like = `%${search}%`;
    if (isNumericSearch) {
      const searchInt = parseInt(search, 10);
      conds.push(Prisma.sql`(sr."samplingNo" = ${searchInt} OR sr."shadeName" ILIKE ${like})`);
    } else {
      conds.push(Prisma.sql`sr."shadeName" ILIKE ${like}`);
    }
  }
  const whereClause = conds.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`
    : Prisma.empty;

  const offset = (page - 1) * pageSize;

  try {
    // ── Main query: paginated list with lastUsedAt joined in ──────────────
    interface RawRow {
      samplingNo:     number;
      shadeName:      string;
      tinterType:     TinterType;
      siteId:         number | null;
      siteNameRaw:    string | null;
      salesOfficerId: number | null;
      dealerName:     string | null;
      isActive:       boolean;
      needsReview:    boolean;
      createdAt:      Date;
      updatedAt:      Date;
      lastUsedAt:     Date | null;
    }
    const rawRows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT
        sr."samplingNo",
        sr."shadeName",
        sr."tinterType",
        sr."siteId",
        sr."siteNameRaw",
        sr."salesOfficerId",
        sr."dealerName",
        sr."isActive",
        sr."needsReview",
        sr."createdAt",
        sr."updatedAt",
        usage."lastUsedAt"
      FROM sampling_register sr
      LEFT JOIN (
        SELECT "samplingNo", MAX("usageDate") AS "lastUsedAt"
          FROM sampling_usage_log
         GROUP BY "samplingNo"
      ) usage ON usage."samplingNo" = sr."samplingNo"
      ${whereClause}
      ORDER BY usage."lastUsedAt" DESC NULLS LAST, sr."samplingNo" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    // ── Total count (same filters, sequential — no $transaction) ──────────
    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total FROM sampling_register sr ${whereClause}
    `);
    const total      = Number(countRows[0]?.total ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

    // ── Follow-up relation fetches (sequential) ───────────────────────────
    const samplingNos = rawRows.map((r) => r.samplingNo);
    const siteIds = Array.from(
      new Set(rawRows.map((r) => r.siteId).filter((id): id is number => id !== null)),
    );
    const soIds = Array.from(
      new Set(rawRows.map((r) => r.salesOfficerId).filter((id): id is number => id !== null)),
    );

    const sites = siteIds.length === 0
      ? []
      : await prisma.delivery_point_master.findMany({
          where:  { id: { in: siteIds } },
          select: { id: true, customerName: true },
        });
    const sos = soIds.length === 0
      ? []
      : await prisma.sales_officer_master.findMany({
          where:  { id: { in: soIds } },
          select: { id: true, name: true },
        });
    const recipeCounts = samplingNos.length === 0
      ? []
      : await prisma.sampling_recipes.groupBy({
          by:     ["samplingNo"],
          _count: { _all: true },
          where:  { samplingNo: { in: samplingNos } },
        });

    const siteMap        = new Map(sites.map((s) => [s.id, s.customerName]));
    const soMap          = new Map(sos.map((s) => [s.id, s.name]));
    const recipeCountMap = new Map(recipeCounts.map((r) => [r.samplingNo, r._count._all]));

    const items = rawRows.map((r) => ({
      samplingNo:       r.samplingNo,
      shadeName:        r.shadeName,
      tinterType:       r.tinterType,
      siteName:         r.siteId !== null ? siteMap.get(r.siteId) ?? null : null,
      siteNameRaw:      r.siteNameRaw,
      siteMissing:      r.siteId === null && r.siteNameRaw !== null,
      salesOfficerName: r.salesOfficerId !== null ? soMap.get(r.salesOfficerId) ?? null : null,
      dealerName:       r.dealerName,
      isActive:         r.isActive,
      needsReview:      r.needsReview,
      recipeCount:      recipeCountMap.get(r.samplingNo) ?? 0,
      createdAt:        r.createdAt.toISOString(),
      updatedAt:        r.updatedAt.toISOString(),
      lastUsedAt:       r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    }));

    return NextResponse.json({ items, total, page, pageSize, totalPages });
  } catch (err) {
    console.error("[sampling-library/list]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST /api/sampling-library ──────────────────────────────────────────────
// Creates a new sampling (parent) and optionally its first variant.
// Permission: canImport.
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canImport");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const createdById = parseInt(session.user.id, 10);
  if (!Number.isFinite(createdById)) {
    return NextResponse.json({ error: "Session missing user id" }, { status: 500 });
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

  // shadeName
  const shadeName = typeof b.shadeName === "string" ? b.shadeName.trim() : "";
  if (!shadeName) {
    return NextResponse.json({ error: "shadeName is required", field: "shadeName" }, { status: 400 });
  }

  // tinterType
  if (!isValidTinterType(b.tinterType)) {
    return NextResponse.json({ error: "tinterType must be TINTER or ACOTONE", field: "tinterType" }, { status: 400 });
  }
  const tinterType: TinterType = b.tinterType;

  // siteId
  let siteId: number | null = null;
  if (b.siteId != null) {
    if (typeof b.siteId !== "number" || !Number.isInteger(b.siteId) || b.siteId <= 0) {
      return NextResponse.json({ error: "siteId must be a positive integer or null", field: "siteId" }, { status: 400 });
    }
    siteId = b.siteId;
  }

  // salesOfficerId
  let salesOfficerId: number | null = null;
  if (b.salesOfficerId != null) {
    if (typeof b.salesOfficerId !== "number" || !Number.isInteger(b.salesOfficerId) || b.salesOfficerId <= 0) {
      return NextResponse.json({ error: "salesOfficerId must be a positive integer or null", field: "salesOfficerId" }, { status: 400 });
    }
    salesOfficerId = b.salesOfficerId;
  }

  // dealerName
  let dealerName: string | null = null;
  if (b.dealerName != null) {
    if (typeof b.dealerName !== "string") {
      return NextResponse.json({ error: "dealerName must be string or null", field: "dealerName" }, { status: 400 });
    }
    const trimmed = b.dealerName.trim();
    dealerName = trimmed.length > 0 ? trimmed : null;
  }

  // notes
  let notes: string | null = null;
  if (b.notes != null) {
    if (typeof b.notes !== "string") {
      return NextResponse.json({ error: "notes must be string or null", field: "notes" }, { status: 400 });
    }
    notes = b.notes;
  }

  // firstVariant (optional)
  let firstVariant: {
    skuCode:     string;
    productName: string | null;
    packCode:    PackCode;
    tinQty:      number;
    pigments:    Record<string, number>;
    isPrimary:   boolean;
  } | null = null;
  if (b.firstVariant != null) {
    if (typeof b.firstVariant !== "object") {
      return NextResponse.json({ error: "firstVariant must be an object or null", field: "firstVariant" }, { status: 400 });
    }
    const fv = b.firstVariant as Record<string, unknown>;
    if (typeof fv.skuCode !== "string" || !fv.skuCode.trim()) {
      return NextResponse.json({ error: "firstVariant.skuCode is required", field: "firstVariant.skuCode" }, { status: 400 });
    }
    if (!isValidPackCode(fv.packCode)) {
      return NextResponse.json({ error: "firstVariant.packCode is invalid", field: "firstVariant.packCode" }, { status: 400 });
    }
    let productName: string | null = null;
    if (fv.productName != null) {
      if (typeof fv.productName !== "string") {
        return NextResponse.json({ error: "firstVariant.productName must be string or null", field: "firstVariant.productName" }, { status: 400 });
      }
      const t = fv.productName.trim();
      productName = t.length > 0 ? t : null;
    }
    const tinQty = typeof fv.tinQty === "number" && Number.isFinite(fv.tinQty) && fv.tinQty >= 0
      ? fv.tinQty
      : 0;
    const isPrimary = typeof fv.isPrimary === "boolean" ? fv.isPrimary : true;
    firstVariant = {
      skuCode:     fv.skuCode.trim(),
      productName,
      packCode:    fv.packCode,
      tinQty,
      pigments:    buildPigmentNumbers(fv.pigments),
      isPrimary,
    };
  }

  // ── Allocate next samplingNo ──────────────────────────────────────────────
  const maxAgg = await prisma.sampling_register.aggregate({ _max: { samplingNo: true } });
  const nextSamplingNo = (maxAgg._max.samplingNo ?? 0) + 1;

  // ── Create parent ─────────────────────────────────────────────────────────
  let parent: { samplingNo: number; shadeName: string; tinterType: TinterType };
  try {
    parent = await prisma.sampling_register.create({
      data: {
        samplingNo: nextSamplingNo,
        shadeName,
        tinterType,
        siteId,
        salesOfficerId,
        dealerName,
        notes,
        createdById,
      },
      select: { samplingNo: true, shadeName: true, tinterType: true },
    });
  } catch (err) {
    console.error("[sampling-library/create-parent]", err);
    return NextResponse.json({ error: "Failed to create sampling" }, { status: 500 });
  }

  // ── Optionally create first variant ───────────────────────────────────────
  let recipeCount = 0;
  if (firstVariant) {
    try {
      await prisma.sampling_recipes.create({
        data: {
          samplingNo:  parent.samplingNo,
          skuCode:     firstVariant.skuCode,
          productName: firstVariant.productName,
          packCode:    firstVariant.packCode,
          tinQty:      firstVariant.tinQty,
          ...firstVariant.pigments,
          isPrimary:   firstVariant.isPrimary,
        },
      });
      recipeCount = 1;
    } catch (err) {
      // No transactions per CORE §3 — accept partial state with clear diagnostic.
      console.error("[sampling-library/create-variant]", err);
      const msg = err instanceof Error ? err.message : "unknown error";
      return NextResponse.json({
        error: `Parent created with samplingNo=${parent.samplingNo}, but variant creation failed: ${msg}. Add the variant manually.`,
        samplingNo: parent.samplingNo,
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    samplingNo:  parent.samplingNo,
    shadeName:   parent.shadeName,
    tinterType:  parent.tinterType,
    recipeCount,
  }, { status: 201 });
}
