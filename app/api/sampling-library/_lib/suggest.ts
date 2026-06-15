import { prisma } from "@/lib/prisma";
import type { PackCode, Prisma, TinterType } from "@prisma/client";
import { PIGMENT_CODES, decToNum, type PigmentCode } from "./validate";

// ── Public types ────────────────────────────────────────────────────────────
// Matches Phase 4 execution spec §4.1 exactly so the UI in step 9 can
// import these types and type-check against them.

export interface ActivePigment {
  code:  string;
  value: number;
}

export interface SuggestExactMatch {
  samplingNo:           string;
  shadeName:            string;
  tinterType:           TinterType;
  recipeId:             number;
  skuCode:              string;
  packCode:             PackCode | null;
  pigments:             Record<string, number>;
  activePigments:       ActivePigment[];
  usageCountAtThisSite: number;
  totalUsageCount:      number;
  lastUsedAt:           string;
  isPrimary:            boolean;
}

export interface SuggestReferenceItem {
  samplingNo:           string;
  shadeName:            string;
  tinterType:           TinterType;
  recipeId:             number;
  skuCode:              string;
  packCode:             PackCode | null;
  pigments:             Record<string, number>;
  activePigments:       ActivePigment[];
  usageCountAtThisSite: number;
  lastUsedAt:           string;
}

export interface SuggestSiteSummary {
  totalTIs:            number;
  distinctSamplingNos: number;
  isNewSite:           boolean;
}

export interface SuggestResponse {
  exactMatches:       SuggestExactMatch[];
  referenceList:      SuggestReferenceItem[];
  siteHistorySummary: SuggestSiteSummary;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function buildPigmentsAndActive(
  row: Record<PigmentCode, Prisma.Decimal | null>,
): { pigments: Record<string, number>; activePigments: ActivePigment[] } {
  const pigments       = {} as Record<string, number>;
  const activePigments: ActivePigment[] = [];
  for (const code of PIGMENT_CODES) {
    const v = decToNum(row[code]);
    pigments[code] = v;
    if (v > 0) activePigments.push({ code, value: v });
  }
  return { pigments, activePigments };
}

// ── Builder ─────────────────────────────────────────────────────────────────

interface BuildParams {
  siteId:   number;
  skuCode:  string;
  packCode: PackCode;
}

export async function buildSuggestPayload(
  params: BuildParams,
): Promise<SuggestResponse> {
  const { siteId, skuCode, packCode } = params;

  // 1) All usage_log rows for this site. Filter on the log's own siteId
  //    (idx_sampling_usage_log_site) — NOT the parent's. Some legacy
  //    sampling_register rows have siteId=null even when their per-use
  //    logs are correctly tagged with a site; using the parent join would
  //    drop those shades from /suggest entirely (see step 10b diagnostic).
  const logs = await prisma.sampling_usage_log.findMany({
    where:  { siteId },
    select: {
      samplingNo:  true,
      recipeId:    true,
      usageDate:   true,
      sampling:    { select: { shadeName: true, tinterType: true } },
      recipe: {
        select: {
          id:         true,
          skuCode:    true,
          packCode:   true,
          isPrimary:  true,
          usageCount: true,
          YOX: true, LFY: true, GRN: true, TBL: true, WHT: true, MAG: true,
          FFR: true, BLK: true, OXR: true, HEY: true, HER: true, COB: true, COG: true,
          YE2: true, YE1: true, XY1: true, XR1: true, WH1: true, RE2: true,
          RE1: true, OR1: true, NO2: true, NO1: true, MA1: true, GR1: true,
          BU2: true, BU1: true,
        },
      },
    },
  });

  // 2) Group by samplingNo. Track per-samplingNo aggregates + per-variant
  //    aggregates (so we can pick the most-used variant per samplingNo for
  //    the reference list).
  interface VariantAcc {
    recipeId:   number;
    skuCode:    string;
    packCode:   PackCode | null;
    isPrimary:  boolean;
    pigmentRow: Record<PigmentCode, Prisma.Decimal | null>;
    totalUsageCount: number; // sampling_recipes.usageCount
    logCountForVariant: number;
    lastUsedAt: Date | null;
  }
  interface SamplingAcc {
    samplingNo:           string;
    shadeName:            string;
    tinterType:           TinterType;
    usageCountAtThisSite: number;
    lastUsedAt:           Date | null;
    variants:             Map<number, VariantAcc>; // by recipeId
  }

  const bySamplingNo = new Map<string, SamplingAcc>();

  for (const row of logs) {
    if (!row.recipe) continue; // log without a resolved recipeId — skip
    let acc = bySamplingNo.get(row.samplingNo);
    if (!acc) {
      acc = {
        samplingNo:           row.samplingNo,
        shadeName:            row.sampling?.shadeName ?? "",
        tinterType:           row.sampling?.tinterType ?? "TINTER",
        usageCountAtThisSite: 0,
        lastUsedAt:           null,
        variants:             new Map(),
      };
      bySamplingNo.set(row.samplingNo, acc);
    }
    acc.usageCountAtThisSite += 1;
    if (row.usageDate && (!acc.lastUsedAt || row.usageDate > acc.lastUsedAt)) {
      acc.lastUsedAt = row.usageDate;
    }

    let variant = acc.variants.get(row.recipe.id);
    if (!variant) {
      variant = {
        recipeId:           row.recipe.id,
        skuCode:            row.recipe.skuCode,
        packCode:           row.recipe.packCode,
        isPrimary:          row.recipe.isPrimary,
        pigmentRow:         row.recipe as unknown as Record<PigmentCode, Prisma.Decimal | null>,
        totalUsageCount:    row.recipe.usageCount,
        logCountForVariant: 0,
        lastUsedAt:         null,
      };
      acc.variants.set(row.recipe.id, variant);
    }
    variant.logCountForVariant += 1;
    if (row.usageDate && (!variant.lastUsedAt || row.usageDate > variant.lastUsedAt)) {
      variant.lastUsedAt = row.usageDate;
    }
  }

  // 3) Split into exactMatches + referenceList.
  const exactMatches:  SuggestExactMatch[]    = [];
  const referenceList: SuggestReferenceItem[] = [];

  for (const acc of Array.from(bySamplingNo.values())) {
    // Exact: every variant whose (skuCode, packCode) equals the request.
    const exactVariants = Array.from(acc.variants.values()).filter(
      (v) => v.skuCode === skuCode && v.packCode === packCode,
    );
    for (const v of exactVariants) {
      const { pigments, activePigments } = buildPigmentsAndActive(v.pigmentRow);
      exactMatches.push({
        samplingNo:           acc.samplingNo,
        shadeName:            acc.shadeName,
        tinterType:           acc.tinterType,
        recipeId:             v.recipeId,
        skuCode:              v.skuCode,
        packCode:             v.packCode,
        pigments,
        activePigments,
        usageCountAtThisSite: acc.usageCountAtThisSite,
        totalUsageCount:      v.totalUsageCount,
        lastUsedAt:           (v.lastUsedAt ?? acc.lastUsedAt ?? new Date(0)).toISOString(),
        isPrimary:            v.isPrimary,
      });
    }

    // Reference: one row per samplingNo. Skip samplings that *only* have an
    // exact-match variant (otherwise the same shade would show in both
    // sections). Pick the most-used variant of the remaining as the
    // representative.
    const nonExactVariants = Array.from(acc.variants.values()).filter(
      (v) => !(v.skuCode === skuCode && v.packCode === packCode),
    );
    if (nonExactVariants.length === 0) continue;

    const rep = nonExactVariants.sort((a, b) => {
      if (b.logCountForVariant !== a.logCountForVariant) return b.logCountForVariant - a.logCountForVariant;
      const at = a.lastUsedAt?.getTime() ?? 0;
      const bt = b.lastUsedAt?.getTime() ?? 0;
      return bt - at;
    })[0];

    const { pigments, activePigments } = buildPigmentsAndActive(rep.pigmentRow);
    referenceList.push({
      samplingNo:           acc.samplingNo,
      shadeName:            acc.shadeName,
      tinterType:           acc.tinterType,
      recipeId:             rep.recipeId,
      skuCode:              rep.skuCode,
      packCode:             rep.packCode,
      pigments,
      activePigments,
      usageCountAtThisSite: acc.usageCountAtThisSite,
      lastUsedAt:           (rep.lastUsedAt ?? acc.lastUsedAt ?? new Date(0)).toISOString(),
    });
  }

  // 4) Sort + cap. Step 16c: recency-first ranking — most-recent use wins,
  // usage count breaks ties on identical dates. Surfaces current depot
  // practice; old high-count shades stop dominating when habits shift.
  exactMatches.sort((a, b) => {
    const dateCmp = b.lastUsedAt.localeCompare(a.lastUsedAt);
    if (dateCmp !== 0) return dateCmp;
    return b.usageCountAtThisSite - a.usageCountAtThisSite;
  });
  const exactCapped = exactMatches.slice(0, 3);

  referenceList.sort((a, b) => {
    const dateCmp = b.lastUsedAt.localeCompare(a.lastUsedAt);
    if (dateCmp !== 0) return dateCmp;
    return b.usageCountAtThisSite - a.usageCountAtThisSite;
  });
  const referenceCapped = referenceList.slice(0, 5);

  // 5) Site summary. Aggregate distinct samplingNos + totalTIs separately so
  //    we don't double-count when logs lack a recipe (rare) and so the count
  //    is independent of the variant-level filtering above.
  const totalTIs = await prisma.sampling_usage_log.count({
    where: { siteId },
  });
  const distinctSamplingsRows = await prisma.sampling_usage_log.findMany({
    where:    { siteId },
    distinct: ["samplingNo"],
    select:   { samplingNo: true },
  });
  const siteHistorySummary: SuggestSiteSummary = {
    totalTIs,
    distinctSamplingNos: distinctSamplingsRows.length,
    isNewSite:           totalTIs === 0,
  };

  return {
    exactMatches:  exactCapped,
    referenceList: referenceCapped,
    siteHistorySummary,
  };
}
