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
import {
  allocateNextSamplingNo,
  getIstYearPrefix,
} from "../tint/operator/_lib/sampling-resolution";

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
  // Phase 4: samplingNo is now a TEXT column ("26-0001" or legacy "313584"),
  // so we ILIKE-match it the same way as shadeName instead of an integer eq.
  const search = searchParams.get("search")?.trim() ?? "";

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
    // Phase 4 (step 16a): also match by usage_log siteNameRaw and by the
    // joined delivery_point_master customerCode / customerName. EXISTS keeps
    // the parent row de-duped no matter how many usage rows match. The LEFT
    // JOIN is so siteId=null rows still surface via siteNameRaw.
    conds.push(Prisma.sql`(
      sr."samplingNo" ILIKE ${like}
      OR sr."shadeName"  ILIKE ${like}
      OR EXISTS (
        SELECT 1
          FROM sampling_usage_log ul
          LEFT JOIN delivery_point_master dpm ON dpm.id = ul."siteId"
         WHERE ul."samplingNo" = sr."samplingNo"
           AND (
             ul."siteNameRaw"   ILIKE ${like}
             OR dpm."customerCode" ILIKE ${like}
             OR dpm."customerName" ILIKE ${like}
           )
      )
    )`);
  }
  const whereClause = conds.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`
    : Prisma.empty;

  const offset = (page - 1) * pageSize;

  try {
    // ── Main query: paginated list with lastUsedAt joined in ──────────────
    interface RawRow {
      samplingNo:     string;
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
    const recipeCountMap = new Map(recipeCounts.map((r) => [r.samplingNo, r._count?._all ?? 0]));

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

  // ── Allocate next samplingNo (race-safe via next_sampling_no()) ───────────
  // Phase 4: samplingNo is a string in "YY-NNNN" format, allocated by the
  // Postgres helper. P2002 retry mirrors createBatchWithRetry in import/obd.
  let parent: { samplingNo: string; shadeName: string; tinterType: TinterType };
  const yearPrefix = getIstYearPrefix();
  let lastErr: unknown = null;
  let created = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const samplingNo = await allocateNextSamplingNo(yearPrefix);
    try {
      parent = await prisma.sampling_register.create({
        data: {
          samplingNo,
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
      created = true;
      break;
    } catch (err) {
      lastErr = err;
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isP2002 || attempt === 2) {
        console.error("[sampling-library/create-parent]", err);
        return NextResponse.json({ error: "Failed to create sampling" }, { status: 500 });
      }
    }
  }
  if (!created) {
    console.error("[sampling-library/create-parent] exhausted retries", lastErr);
    return NextResponse.json({ error: "Failed to allocate sampling number" }, { status: 500 });
  }
  parent = parent!;

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
