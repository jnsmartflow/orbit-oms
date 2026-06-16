import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { PackCode, Prisma, TinterType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PIGMENT_CODES,
  buildPigmentNumbers,
  decToNum,
  isValidPackCode,
  isValidTinterType,
  type PigmentCode,
} from "../_lib/validate";
import {
  assembleFlatRow,
  groupOtherSitesBySampling,
  type SuggestFlatRow,
} from "../_lib/suggest";
import { canScale, perLitreFingerprint } from "@/lib/sampling/pack-litres";

export const dynamic = "force-dynamic";

// Cap returned matches — an exact 27-pigment match is highly selective, so this
// is a safety bound, not an expected truncation.
const MATCH_LIMIT = 20;
// Generous pre-dedup fetch bound (recipes, before grouping to one row/sampling).
const FETCH_LIMIT = 100;

// ── POST /api/sampling-library/formula-match ────────────────────────────────
// Same-shade reuse lookup for the pop-up. Formula IS the identity (no
// base/product). Returns ACTIVE same-tinterType samplings whose recipe matches
// the input PER LITRE (dose basis) — so a 20L recipe matches a 4L entry of the
// same shade — falling back to exact raw equality when a pack can't be scaled.
// Rows share the search-list SuggestFlatRow shape. Auth: sampling_library:canView.
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (!isValidTinterType(b.tinterType)) {
    return NextResponse.json({ error: "tinterType must be TINTER or ACOTONE", field: "tinterType" }, { status: 400 });
  }
  const tinterType: TinterType = b.tinterType;

  const excludeSamplingNo =
    typeof b.excludeSamplingNo === "string" && b.excludeSamplingNo.trim() !== ""
      ? b.excludeSamplingNo.trim()
      : undefined;

  // The typed shade's line pack — drives per-litre scaling. Optional/unknown →
  // null → exact raw match only.
  const inputPackCode: PackCode | null =
    typeof b.packCode === "string" && isValidPackCode(b.packCode) ? b.packCode : null;

  // 27 pigment values, same shape as the operator save/suggest payload (codes as
  // top-level keys). buildPigmentNumbers clamps negatives/non-finite to 0.
  const pigments = buildPigmentNumbers(b);

  // GUARD: never match the all-zero formula (every base shares it).
  if (PIGMENT_CODES.every((c) => pigments[c] === 0)) {
    return NextResponse.json({ matches: [] }, { status: 200 });
  }

  try {
    // Pre-filter (cheap, narrows candidates): same active/zero column pattern as
    // the input — scaled versions of a formula share the EXACT set of non-zero
    // columns, so this is safe. Per-column: gt 0 where the input is non-zero,
    // equals 0 where the input is zero.
    const where: Prisma.sampling_recipesWhereInput = {
      sampling: { isActive: true, tinterType },
      ...(excludeSamplingNo ? { samplingNo: { not: excludeSamplingNo } } : {}),
    };
    for (const c of PIGMENT_CODES) {
      (where as Record<string, unknown>)[c] = pigments[c] > 0 ? { gt: 0 } : { equals: 0 };
    }

    const candidates = await prisma.sampling_recipes.findMany({
      where,
      take: FETCH_LIMIT,
      include: {
        sampling: { select: { shadeName: true, tinterType: true, createdAt: true } },
      },
    });

    // JS compare: per-litre fingerprint when both packs scale (catches 20L↔4L
    // etc.), else exact raw equality of all 27 values.
    const inputFp = perLitreFingerprint(pigments, inputPackCode, PIGMENT_CODES);
    const matched = candidates.filter((r) => {
      const candValues: Record<string, number> = {};
      for (const c of PIGMENT_CODES) {
        candValues[c] = decToNum((r as unknown as Record<PigmentCode, Prisma.Decimal | null>)[c]);
      }
      if (inputFp !== null && canScale(inputPackCode, r.packCode)) {
        const candFp = perLitreFingerprint(candValues, r.packCode, PIGMENT_CODES);
        return candFp !== null && candFp === inputFp;
      }
      return PIGMENT_CODES.every((c) => candValues[c] === pigments[c]);
    });

    // One row per sampling — prefer the primary recipe, else first match.
    interface Rep {
      recipe:     (typeof candidates)[number];
      samplingNo: string;
      createdAt:  Date;
    }
    const repBySampling = new Map<string, Rep>();
    for (const r of matched) {
      const cur = repBySampling.get(r.samplingNo);
      if (!cur) {
        repBySampling.set(r.samplingNo, { recipe: r, samplingNo: r.samplingNo, createdAt: r.sampling.createdAt });
        continue;
      }
      if (r.isPrimary && !cur.recipe.isPrimary) {
        repBySampling.set(r.samplingNo, { recipe: r, samplingNo: r.samplingNo, createdAt: r.sampling.createdAt });
      }
    }

    // ORDER: 26-series first, then createdAt desc (newest first). Cap.
    const reps = Array.from(repBySampling.values()).sort((a, b2) => {
      const aSer = a.samplingNo.startsWith("26-") ? 0 : 1;
      const bSer = b2.samplingNo.startsWith("26-") ? 0 : 1;
      if (aSer !== bSer) return aSer - bSer;
      return b2.createdAt.getTime() - a.createdAt.getTime();
    }).slice(0, MATCH_LIMIT);

    // Cross-site reuse info (all sites, recent-first) for the capped set.
    const samplingNos = reps.map((r) => r.samplingNo);
    const sitesBySampling = await groupOtherSitesBySampling(samplingNos, null);

    const matches: SuggestFlatRow[] = reps.map(({ recipe: r }) => {
      const ranked          = sitesBySampling.get(r.samplingNo) ?? [];
      const primarySiteName = ranked[0]?.siteName ?? "";
      const otherSites      = ranked.slice(1);
      return assembleFlatRow({
        samplingNo:           r.samplingNo,
        shadeName:            r.sampling.shadeName,
        tinterType:           r.sampling.tinterType,
        recipeId:             r.id,
        skuCode:              r.skuCode,
        packCode:             r.packCode,
        pigmentRow:           r as unknown as Record<PigmentCode, Prisma.Decimal | null>,
        totalUsageCount:      r.usageCount,
        isPrimary:            r.isPrimary,
        lastUsedAt:           r.lastUsedAt,
        usageCountAtThisSite: r.usageCount,
        isExactMatch:         false,
        primarySiteName,
        otherSites,
      });
    });

    return NextResponse.json({ matches }, { status: 200 });
  } catch (err) {
    console.error("[sampling-library/formula-match]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
