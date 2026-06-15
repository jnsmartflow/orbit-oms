import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { Prisma, TinterType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidTinterType, type PigmentCode } from "../_lib/validate";
import {
  assembleFlatRow,
  groupOtherSitesBySampling,
  type SuggestFlatRow,
} from "../_lib/suggest";

export const dynamic = "force-dynamic";

// Bound the response. Matching is partial-contains; a vague query could match
// many samplings, so we order by recency and return only the freshest N.
const RESULT_LIMIT = 50;

// ── GET /api/sampling-library/operator-search?q=&type= ──────────────────────
// Operator-screen global search. Partial (ILIKE contains) match across ALL
// sites on samplingNo / shadeName / usage site name. NO fuzzy (CORE §3 — never
// fuzzy-match site names). Returns applyable rows in the SAME shape as the
// /suggest flat list (SuggestFlatRow) so the picker consumes them unchanged.
// Auth: sampling_library:canView (same as /suggest).
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
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required", field: "q" }, { status: 400 });
  }

  const typeRaw = searchParams.get("type")?.trim();
  if (typeRaw && !isValidTinterType(typeRaw)) {
    return NextResponse.json({ error: "type must be TINTER or ACOTONE", field: "type" }, { status: 400 });
  }
  const type: TinterType | undefined = typeRaw ? (typeRaw as TinterType) : undefined;

  try {
    // 1) Matching samplings — partial contains on samplingNo OR shadeName OR
    //    any usage site name (raw siteNameRaw OR resolved master customerName).
    const matches = await prisma.sampling_register.findMany({
      where: {
        ...(type ? { tinterType: type } : {}),
        OR: [
          { samplingNo: { contains: q, mode: "insensitive" } },
          { shadeName:  { contains: q, mode: "insensitive" } },
          {
            usageLog: {
              some: {
                OR: [
                  { siteNameRaw: { contains: q, mode: "insensitive" } },
                  { site: { customerName: { contains: q, mode: "insensitive" } } },
                ],
              },
            },
          },
        ],
      },
      select: { samplingNo: true, shadeName: true, tinterType: true },
    });
    if (matches.length === 0) {
      return NextResponse.json({ rows: [] }, { status: 200 });
    }
    const matchedNos = matches.map((m) => m.samplingNo);

    // 2) Per-sampling recency + usage count (for ordering + display).
    const usageAgg = await prisma.sampling_usage_log.groupBy({
      by:     ["samplingNo"],
      where:  { samplingNo: { in: matchedNos } },
      _max:   { usageDate: true },
      _count: { _all: true },
    });
    const lastUsedMap   = new Map<string, Date | null>();
    const usageCountMap = new Map<string, number>();
    for (const g of usageAgg) {
      lastUsedMap.set(g.samplingNo, g._max.usageDate ?? null);
      usageCountMap.set(g.samplingNo, g._count._all ?? 0);
    }

    // 3) Order most-recent first (NULLS LAST), samplingNo DESC tiebreak; cap.
    const ordered = matches
      .slice()
      .sort((a, b) => {
        const at = lastUsedMap.get(a.samplingNo)?.getTime() ?? -1;
        const bt = lastUsedMap.get(b.samplingNo)?.getTime() ?? -1;
        if (bt !== at) return bt - at;
        return b.samplingNo.localeCompare(a.samplingNo);
      })
      .slice(0, RESULT_LIMIT);
    const topNos = ordered.map((m) => m.samplingNo);

    // 4) Representative recipe per sampling — prefer isPrimary, then most
    //    recent, then higher usageCount. (No current-line context here, so no
    //    exact-match concept — isExactMatch is always false.)
    const recipes = await prisma.sampling_recipes.findMany({
      where: { samplingNo: { in: topNos } },
    });
    const repBySampling = new Map<string, (typeof recipes)[number]>();
    for (const r of recipes) {
      const cur = repBySampling.get(r.samplingNo);
      if (!cur) { repBySampling.set(r.samplingNo, r); continue; }
      const rRank   = r.isPrimary ? 1 : 0;
      const curRank = cur.isPrimary ? 1 : 0;
      if (rRank !== curRank) {
        if (rRank > curRank) repBySampling.set(r.samplingNo, r);
        continue;
      }
      const rT   = r.lastUsedAt?.getTime() ?? 0;
      const curT = cur.lastUsedAt?.getTime() ?? 0;
      if (rT !== curT) {
        if (rT > curT) repBySampling.set(r.samplingNo, r);
        continue;
      }
      if (r.usageCount > cur.usageCount) repBySampling.set(r.samplingNo, r);
    }

    // 5) Sites per sampling — shared helper with NO exclusion (global search has
    //    no "current site"): primary = most-recent site, rest = otherSites.
    const sitesBySampling = await groupOtherSitesBySampling(topNos, null);

    // 6) Assemble rows in SuggestFlatRow shape.
    const rows: SuggestFlatRow[] = [];
    for (const m of ordered) {
      const rep = repBySampling.get(m.samplingNo);
      if (!rep) continue; // sampling without a recipe — not applyable, skip
      const ranked          = sitesBySampling.get(m.samplingNo) ?? [];
      const primarySiteName = ranked[0]?.siteName ?? "";
      const otherSites      = ranked.slice(1);
      rows.push(assembleFlatRow({
        samplingNo:           m.samplingNo,
        shadeName:            m.shadeName,
        tinterType:           m.tinterType,
        recipeId:             rep.id,
        skuCode:              rep.skuCode,
        packCode:             rep.packCode,
        pigmentRow:           rep as unknown as Record<PigmentCode, Prisma.Decimal | null>,
        totalUsageCount:      rep.usageCount,
        isPrimary:            rep.isPrimary,
        lastUsedAt:           lastUsedMap.get(m.samplingNo) ?? rep.lastUsedAt ?? null,
        // No "this site" in a global search — surface total usage so the row
        // can still show a count; the picker treats this as informational.
        usageCountAtThisSite: usageCountMap.get(m.samplingNo) ?? 0,
        isExactMatch:         false,
        primarySiteName,
        otherSites,
      }));
    }

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err) {
    console.error("[sampling-library/operator-search]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
